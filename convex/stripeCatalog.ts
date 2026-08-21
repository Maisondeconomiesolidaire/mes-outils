/**
 * Miroir du stock boutique dans le catalogue Stripe.
 *
 * Chaque article de Recycapp devient un « product » Stripe portant un
 * « price ». Recycapp reste la SOURCE DE VÉRITÉ : la synchronisation ne va que
 * dans ce sens. Rien n'est jamais relu depuis Stripe pour écraser le stock —
 * un objet unique de recyclerie n'existe qu'ici, et un catalogue Stripe modifié
 * à la main ne doit pas pouvoir remettre en vente un meuble déjà parti.
 *
 * Trois déclencheurs :
 *  - à chaque écriture sur un article (création, modification, statut,
 *    suppression), via `scheduleStripeSync` ;
 *  - à la demande, depuis le CRM (`syncAll`) ;
 *  - toutes les nuits, en filet de sécurité (`reconcile`), pour rattraper un
 *    changement de statut fait par un chemin qui n'appelle pas la planification
 *    (encaissement en caisse, remboursement…).
 *
 * Un prix Stripe est IMMUABLE : changer le prix d'un article crée un nouveau
 * price, le désigne comme prix par défaut et archive l'ancien.
 */
import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  action,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { accessAllows } from "./lib";
import { recycappSecretKey, stripeRequest } from "./stripe";

/** Stripe n'accepte que 8 images par produit. */
const MAX_IMAGES = 8;
/** Longueur maximale d'un nom de produit Stripe. */
const MAX_NAME = 250;
const MAX_DESCRIPTION = 500;

/**
 * Planifie la synchronisation d'un article vers Stripe.
 *
 * Appelée depuis les mutations : une mutation ne peut pas parler au réseau, et
 * surtout un appel à Stripe ne doit jamais faire échouer une écriture en base.
 * L'action part juste après, et son échec éventuel reste sans effet sur le
 * stock — la réconciliation nocturne rattrapera.
 */
export async function scheduleStripeSync(
  ctx: MutationCtx,
  articleId: Id<"articles">,
) {
  await ctx.scheduler.runAfter(0, internal.stripeCatalog.syncArticle, {
    articleId,
  });
}

/** État d'un article tel qu'il doit apparaître chez Stripe. */
export const articleSnapshot = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) return null;
    const imageUrls = (
      await Promise.all(
        article.images.slice(0, MAX_IMAGES).map((id) => ctx.storage.getUrl(id)),
      )
    ).filter((url): url is string => url !== null);

    return {
      title: article.title,
      description: article.description,
      price: article.price,
      status: article.status,
      category: article.category,
      internalReference: article.internalReference ?? null,
      site: article.site ?? null,
      imageUrls,
      stripeProductId: article.stripeProductId ?? null,
      stripePriceId: article.stripePriceId ?? null,
      stripePriceAmount: article.stripePriceAmount ?? null,
      stripeActive: article.stripeActive ?? null,
    };
  },
});

export const saveStripeIds = internalMutation({
  args: {
    articleId: v.id("articles"),
    stripeProductId: v.string(),
    stripePriceId: v.string(),
    stripePriceAmount: v.number(),
    stripeActive: v.boolean(),
  },
  handler: async (ctx, { articleId, ...ids }) => {
    const article = await ctx.db.get(articleId);
    if (!article) return null;
    await ctx.db.patch(articleId, { ...ids, stripeSyncedAt: Date.now() });
    return null;
  },
});

/**
 * Un article n'est achetable que disponible : réservé, vendu, en attente ou en
 * lot, son produit Stripe est désactivé.
 */
function isPurchasable(status: string) {
  return status === "disponible";
}

function centimes(price: number) {
  return Math.round(price * 100);
}

/** Synchronise UN article. Idempotent : sans changement, aucun appel Stripe. */
export const syncArticle = internalAction({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }): Promise<{ status: string }> => {
    const secretKey = recycappSecretKey();
    const snapshot = await ctx.runQuery(internal.stripeCatalog.articleSnapshot, {
      articleId,
    });

    // Article supprimé entre la planification et l'exécution : rien à faire.
    // Son produit Stripe, s'il existait, a été archivé par `archiveProduct`.
    if (!snapshot) return { status: "absent" };

    const active = isPurchasable(snapshot.status);
    const amount = centimes(snapshot.price);
    const name = snapshot.title.slice(0, MAX_NAME) || "Article";
    const description = snapshot.description.trim().slice(0, MAX_DESCRIPTION);

    const productFields: Record<string, string> = {
      name,
      active: String(active),
      "metadata[articleId]": String(articleId),
      "metadata[source]": "recycapp",
      ...(snapshot.internalReference
        ? { "metadata[internalReference]": snapshot.internalReference }
        : {}),
      ...(snapshot.site ? { "metadata[site]": snapshot.site } : {}),
      "metadata[category]": snapshot.category,
      ...(description ? { description } : {}),
    };
    snapshot.imageUrls.forEach((url, index) => {
      productFields[`images[${index}]`] = url;
    });

    let productId = snapshot.stripeProductId;
    if (!productId) {
      const product = await stripeRequest<{ id: string }>(
        "products",
        secretKey,
        productFields,
      );
      productId = product.id;
    } else {
      await stripeRequest(`products/${productId}`, secretKey, productFields);
    }

    // Un price Stripe est immuable : un prix qui change en crée un nouveau.
    let priceId = snapshot.stripePriceId;
    if (!priceId || snapshot.stripePriceAmount !== amount) {
      const price = await stripeRequest<{ id: string }>("prices", secretKey, {
        product: productId,
        currency: "eur",
        unit_amount: String(amount),
      });
      await stripeRequest(`products/${productId}`, secretKey, {
        default_price: price.id,
      });
      if (priceId) {
        await stripeRequest(`prices/${priceId}`, secretKey, { active: "false" });
      }
      priceId = price.id;
    }

    await ctx.runMutation(internal.stripeCatalog.saveStripeIds, {
      articleId,
      stripeProductId: productId,
      stripePriceId: priceId,
      stripePriceAmount: amount,
      stripeActive: active,
    });

    return { status: "synced" };
  },
});

/**
 * Archive le produit d'un article supprimé.
 *
 * Stripe refuse de supprimer un produit qui porte un price : on le désactive,
 * ce qui le retire des paiements sans perdre l'historique des ventes passées.
 */
export const archiveProduct = internalAction({
  args: { stripeProductId: v.string(), stripePriceId: v.optional(v.string()) },
  handler: async (_ctx, { stripeProductId, stripePriceId }) => {
    const secretKey = recycappSecretKey();
    if (stripePriceId) {
      await stripeRequest(`prices/${stripePriceId}`, secretKey, {
        active: "false",
      });
    }
    await stripeRequest(`products/${stripeProductId}`, secretKey, {
      active: "false",
    });
    return null;
  },
});

/* ─── Rattrapage ──────────────────────────────────────────────────────────── */

/** Articles dont l'état diffère de ce qui a été poussé chez Stripe. */
export const staleArticles = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    const articles = await ctx.db.query("articles").order("desc").take(1000);
    return articles
      .filter((article) => {
        // Un article déjà vendu et jamais poussé n'a plus rien à faire chez
        // Stripe : on ne remplit pas le catalogue de produits inactifs.
        const purchasable = isPurchasable(article.status);
        if (!article.stripeProductId) return purchasable;
        return (
          article.stripePriceAmount !== centimes(article.price) ||
          article.stripeActive !== purchasable
        );
      })
      .slice(0, limit)
      .map((article) => article._id);
  },
});

/**
 * Filet de sécurité nocturne : repousse ce qui a dérivé.
 *
 * Le statut d'un article change par beaucoup de chemins (encaissement en
 * caisse, commande en ligne, remboursement, retour d'atelier). Plutôt que de
 * planifier une synchro depuis chacun, on compare ici l'état réel à ce qui a
 * été poussé — et on n'appelle Stripe que pour les écarts.
 */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids: Id<"articles">[] = await ctx.runQuery(
      internal.stripeCatalog.staleArticles,
      { limit: 200 },
    );
    for (const articleId of ids) {
      await ctx.scheduler.runAfter(0, internal.stripeCatalog.syncArticle, {
        articleId,
      });
    }
    return { scheduled: ids.length };
  },
});

/** Tous les articles, pour la première mise en ligne du catalogue. */
export const allArticleIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").order("desc").collect();
    return articles.map((article) => article._id);
  },
});

/**
 * CRM : pousse tout le stock vers Stripe.
 *
 * Sert à la première mise en ligne du catalogue ; ensuite, chaque écriture se
 * synchronise seule. Rejouable sans risque — un article déjà à jour ne
 * déclenche aucun appel Stripe.
 */
export const syncAll = action({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, "articles", "update")) {
      throw new Error("Accès CRM insuffisant.");
    }
    const ids: Id<"articles">[] = await ctx.runQuery(
      internal.stripeCatalog.allArticleIds,
      {},
    );
    for (const articleId of ids) {
      await ctx.scheduler.runAfter(0, internal.stripeCatalog.syncArticle, {
        articleId,
      });
    }
    return { scheduled: ids.length };
  },
});
