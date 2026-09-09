/**
 * Publication sur les réseaux sociaux depuis Mes Outils.
 *
 * Facebook n'a pas d'API de programmation à notre charge : on lui envoie le
 * post avec `published=false` et une date, et il le publie lui-même à l'heure
 * dite. Aucun cron de notre côté, donc aucune publication perdue si le
 * déploiement redémarre.
 *
 * Les jetons de Page vivent dans `socialFacebookPages` et ne sortent jamais du
 * backend : le navigateur ne reçoit que l'identifiant et le nom des Pages.
 */
import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { formatUserName, requireCrmPermission, requireUser } from "./lib";

const PAGE_KEY = "mesoutils:actualites";
const GRAPH_VERSION = "v26.0";

/**
 * Facebook n'accepte une programmation qu'entre 10 minutes et 6 mois. On garde
 * une marge de 15 minutes : le temps de la saisie ne doit pas faire basculer la
 * demande sous la limite entre le clic et l'appel.
 */
const MIN_SCHEDULE_MS = 15 * 60 * 1000;
const MAX_SCHEDULE_MS = 180 * 24 * 60 * 60 * 1000;

/** Pages disponibles pour la publication — sans les jetons. */
export const listPages = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "publish");
    const pages = await ctx.db.query("socialFacebookPages").collect();
    return pages
      .filter((page) => page.active)
      .map((page) => ({ pageId: page.pageId, name: page.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

/** Publications déjà émises pour un évènement (Mes Outils ou Recyclerie). */
export const postsForEvent = query({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const posts = args.eventId
      ? await ctx.db
          .query("socialFacebookPosts")
          .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
          .collect()
      : args.recycappEventId
        ? await ctx.db
            .query("socialFacebookPosts")
            .withIndex("by_recycappEvent", (q) =>
              q.eq("recycappEventId", args.recycappEventId),
            )
            .collect()
        : [];
    return posts
      .map((post) => ({
        id: post._id,
        network: post.network ?? ("facebook" as const),
        pageName: post.pageName,
        postId: post.postId,
        scheduledFor: post.scheduledFor,
        createdAt: post.createdAt,
        authorName: post.authorName,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/* ─── Données lues par l'action (qui n'a pas accès à la base) ─────────────── */

export const eventPayload = internalQuery({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    pageId: v.string(),
    /** Instagram publie via ses propres comptes : pas de Page à résoudre. */
    skipPage: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = args.skipPage
      ? { pageId: "", name: "", accessToken: "" }
      : await ctx.db
          .query("socialFacebookPages")
          .withIndex("by_pageId", (q) => q.eq("pageId", args.pageId))
          .unique();
    if (!page || ("active" in page && !page.active)) {
      throw new Error("Page Facebook inconnue ou désactivée.");
    }

    if (args.eventId) {
      const event = await ctx.db.get(args.eventId);
      if (!event) throw new Error("Évènement introuvable.");
      const photoUrl = event.images[0] ? await ctx.storage.getUrl(event.images[0]) : null;
      return {
        page: { pageId: page.pageId, name: page.name, accessToken: page.accessToken },
        event: {
          title: event.title,
          description: event.description,
          location: event.location,
          start: event.start,
          photoUrl,
        },
      };
    }

    if (args.recycappEventId) {
      const event = await ctx.db.get(args.recycappEventId);
      if (!event) throw new Error("Évènement introuvable.");
      const photoUrl = event.attachments[0]
        ? await ctx.storage.getUrl(event.attachments[0])
        : null;
      return {
        page: { pageId: page.pageId, name: page.name, accessToken: page.accessToken },
        event: {
          title: event.title,
          description: [event.animationType, event.activity].filter(Boolean).join(" · ") || undefined,
          location: event.location,
          start: event.startAt,
          // Une pièce jointe n'est pas forcément une image : seule une photo
          // part avec le post, un PDF de programme n'a rien à y faire.
          photoUrl: /\.(jpe?g|png|webp)(\?|$)/i.test(photoUrl ?? "") ? photoUrl : null,
        },
      };
    }

    throw new Error("Aucun évènement fourni.");
  },
});

export const recordPost = internalMutation({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    network: v.optional(v.union(v.literal("facebook"), v.literal("instagram"))),
    pageId: v.string(),
    pageName: v.string(),
    postId: v.string(),
    message: v.string(),
    scheduledFor: v.optional(v.number()),
    withPhoto: v.boolean(),
    authorClerkId: v.string(),
    authorName: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("socialFacebookPosts", { ...args, createdAt: Date.now() });
  },
});

export const assertCanPublish = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "publish");
    const identity = await requireUser(ctx);
    // Le nom affiché est celui de la personne, pas celui de l'outil : la fiche
    // d'un évènement dit qui a publié.
    return { clerkId: identity.subject, name: formatUserName(identity) };
  },
});

/* ─── Publication ─────────────────────────────────────────────────────────── */

/** Texte du post : titre, date, lieu, puis description. */
function buildMessage(event: {
  title: string;
  description?: string;
  location?: string;
  start?: number;
}) {
  const lines = [event.title];
  if (event.start) {
    lines.push(
      new Date(event.start).toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.description) lines.push("", event.description);
  return lines.join("\n");
}

export const publishEvent = action({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    pageId: v.string(),
    /** Absent = publication immédiate ; sinon date de publication (ms). */
    scheduledFor: v.optional(v.number()),
    /** Texte du post, composé depuis l'évènement à défaut. */
    message: v.optional(v.string()),
    /** Photos du post. À défaut, celles de l'évènement. */
    photoStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args): Promise<{ postId: string; scheduledFor?: number }> => {
    const author: { clerkId: string; name: string } = await ctx.runQuery(
      internal.social.assertCanPublish,
      {},
    );

    if (args.scheduledFor !== undefined) {
      const delay = args.scheduledFor - Date.now();
      if (delay < MIN_SCHEDULE_MS) {
        throw new Error(
          "Facebook exige au moins 10 minutes d'avance : choisissez une date un peu plus tard.",
        );
      }
      if (delay > MAX_SCHEDULE_MS) {
        throw new Error("Facebook ne programme pas au-delà de 6 mois.");
      }
    }

    const payload = await ctx.runQuery(internal.social.eventPayload, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
      pageId: args.pageId,
    });

    const message = args.message?.trim() || buildMessage(payload.event);

    // Photos choisies dans le formulaire ; à défaut, celle de l'évènement.
    const photoUrls: string[] = args.photoStorageIds?.length
      ? (
          await Promise.all(
            args.photoStorageIds.map((id) => ctx.storage.getUrl(id as Id<"_storage">)),
          )
        ).filter((url): url is string => Boolean(url))
      : payload.event.photoUrl
        ? [payload.event.photoUrl]
        : [];

    const graph = (path: string, params: URLSearchParams) =>
      fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
        method: "POST",
        body: params,
      });

    const fail = (result: { error?: { message?: string; code?: number } }, status: number) => {
      const detail = result.error?.message ?? `HTTP ${status}`;
      // Le jeton de Page ne se périme pas, mais il saute si le mot de passe du
      // compte change : le dire évite de chercher ailleurs.
      const hint =
        result.error?.code === 190
          ? " Le jeton de la Page n'est plus valide : reconnectez la Page."
          : "";
      return new Error(`Facebook a refusé la publication : ${detail}.${hint}`);
    };

    /**
     * Les photos sont d'abord déposées sans être publiées, puis rattachées au
     * post : c'est le seul montage qui accepte plusieurs images ET une date de
     * publication. Un envoi direct sur `/photos` ne porterait qu'une image.
     */
    const mediaIds: string[] = [];
    for (const url of photoUrls) {
      const params = new URLSearchParams({
        access_token: payload.page.accessToken,
        url,
        published: "false",
      });
      const response = await graph(`${payload.page.pageId}/photos`, params);
      const result = (await response.json()) as {
        id?: string;
        error?: { message?: string; code?: number };
      };
      if (!response.ok || result.error || !result.id) throw fail(result, response.status);
      mediaIds.push(result.id);
    }

    const body = new URLSearchParams({
      access_token: payload.page.accessToken,
      message,
    });
    mediaIds.forEach((id, index) => {
      body.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }));
    });
    if (args.scheduledFor !== undefined) {
      body.set("published", "false");
      body.set("scheduled_publish_time", String(Math.floor(args.scheduledFor / 1000)));
    }

    const response = await graph(`${payload.page.pageId}/feed`, body);
    const result = (await response.json()) as {
      id?: string;
      post_id?: string;
      error?: { message?: string; code?: number };
    };
    if (!response.ok || result.error) throw fail(result, response.status);

    const postId = result.post_id ?? result.id;
    if (!postId) throw new Error("Facebook n'a pas renvoyé d'identifiant de publication.");

    await ctx.runMutation(internal.social.recordPost, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
      pageId: payload.page.pageId,
      pageName: payload.page.name,
      postId,
      message,
      scheduledFor: args.scheduledFor,
      withPhoto: photoUrls.length > 0,
      authorClerkId: author.clerkId,
      authorName: author.name,
    });

    return { postId, scheduledFor: args.scheduledFor };
  },
});

/**
 * Enregistre (ou met à jour) une Page et son jeton.
 *
 * Interne : les jetons sont posés depuis la ligne de commande, comme les
 * variables d'environnement, et n'ont pas à transiter par une page web.
 */
export const upsertPage = internalMutation({
  args: {
    pageId: v.string(),
    name: v.string(),
    accessToken: v.string(),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("socialFacebookPages")
      .withIndex("by_pageId", (q) => q.eq("pageId", args.pageId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        accessToken: args.accessToken,
        active: args.active ?? true,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("socialFacebookPages", {
      pageId: args.pageId,
      name: args.name,
      accessToken: args.accessToken,
      active: args.active ?? true,
      createdAt: Date.now(),
    });
  },
});

/* ─── Publications supprimées côté Facebook ───────────────────────────────── */

export const recordedPosts = internalQuery({
  args: {
    /** Restreint la vérification aux publications d'un évènement. */
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
  },
  handler: async (ctx, args) => {
    const [all, pages] = await Promise.all([
      ctx.db.query("socialFacebookPosts").collect(),
      ctx.db.query("socialFacebookPages").collect(),
    ]);
    const scoped =
      args.eventId || args.recycappEventId
        ? all.filter(
            (post) =>
              (args.eventId && post.eventId === args.eventId) ||
              (args.recycappEventId && post.recycappEventId === args.recycappEventId),
          )
        : all;
    // Instagram n'expose pas de liste comparable : ses publications ne sont pas
    // vérifiées, plutôt que jugées disparues faute de pouvoir les retrouver.
    const posts = scoped.filter((post) => (post.network ?? "facebook") === "facebook");
    const tokenByPage = new Map(pages.map((page) => [page.pageId, page.accessToken]));
    return posts
      .map((post) => ({
        id: post._id,
        postId: post.postId,
        pageId: post.pageId,
        createdAt: post.createdAt,
        accessToken: tokenByPage.get(post.pageId),
      }))
      // Une Page retirée de la configuration n'a plus de jeton : sans lui, on ne
      // peut rien vérifier, et supprimer la ligne serait une conclusion hâtive.
      .filter(
        (
          post,
        ): post is {
          id: Id<"socialFacebookPosts">;
          postId: string;
          pageId: string;
          createdAt: number;
          accessToken: string;
        } => Boolean(post.accessToken),
      );
  },
});

export const forgetPost = internalMutation({
  args: { id: v.id("socialFacebookPosts") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

/** Identifiants d'une liste Graph, en suivant la pagination. */
async function collectIds(url: string, max = 300) {
  const ids = new Set<string>();
  let oldest: number | undefined;
  let next: string | undefined = url;
  while (next && ids.size < max) {
    const response = await fetch(next);
    const result = (await response.json()) as {
      data?: Array<{ id: string; created_time?: string }>;
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (result.error || !result.data) break;
    for (const item of result.data) {
      ids.add(item.id);
      if (item.created_time) {
        const time = Date.parse(item.created_time);
        if (Number.isFinite(time)) oldest = Math.min(oldest ?? time, time);
      }
    }
    next = result.paging?.next;
  }
  return { ids, oldest };
}

/**
 * Retire les publications qui n'existent plus sur Facebook.
 *
 * Une publication supprimée depuis Facebook ou Meta Business Suite — ou une
 * programmation annulée — laissait une ligne « Publié le… » sur la fiche de
 * l'évènement, qui affirmait une annonce qui n'existe plus.
 *
 * La vérification passe par les listes de la Page (`feed` et `scheduled_posts`)
 * et non par l'identifiant du post : interroger `/{postId}?fields=id` renvoie
 * l'identifiant même pour un objet disparu, ce qui ne prouvait rien.
 *
 * En cas de doute, la ligne est conservée : une liste illisible (jeton
 * invalide, panne réseau) ou une publication plus ancienne que la fenêtre
 * consultée ne prouvent pas une suppression.
 */
export const reconcilePosts = internalAction({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
  },
  handler: async (ctx, args): Promise<{ checked: number; forgotten: number }> => {
    const posts: Array<{
      id: Id<"socialFacebookPosts">;
      postId: string;
      pageId: string;
      createdAt: number;
      accessToken: string;
    }> = await ctx.runQuery(internal.social.recordedPosts, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
    });

    const byPage = new Map<string, typeof posts>();
    for (const post of posts) {
      byPage.set(post.pageId, [...(byPage.get(post.pageId) ?? []), post]);
    }

    let forgotten = 0;
    for (const [pageId, pagePosts] of byPage) {
      const token = encodeURIComponent(pagePosts[0].accessToken);
      const base = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}`;
      try {
        const [published, scheduled] = await Promise.all([
          collectIds(`${base}/feed?fields=id,created_time&limit=100&access_token=${token}`),
          collectIds(`${base}/scheduled_posts?fields=id&limit=100&access_token=${token}`),
        ]);
        // Aucune liste lisible : on ne conclut rien pour cette Page.
        if (published.ids.size === 0 && scheduled.ids.size === 0 && published.oldest === undefined) {
          continue;
        }
        for (const post of pagePosts) {
          if (published.ids.has(post.postId) || scheduled.ids.has(post.postId)) continue;
          // Publication antérieure à la fenêtre consultée : son absence de la
          // liste ne dit pas qu'elle a été supprimée.
          if (published.oldest !== undefined && post.createdAt < published.oldest) continue;
          await ctx.runMutation(internal.social.forgetPost, { id: post.id });
          forgotten += 1;
        }
      } catch (error) {
        // Réseau indisponible : on retentera à la prochaine passe.
        console.warn(
          `Vérification des publications de la Page ${pageId} impossible :`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return { checked: posts.length, forgotten };
  },
});

/**
 * Vérifie les publications d'un seul évènement, à l'ouverture de sa fiche.
 *
 * La repasse horaire suffit à tenir la liste à jour, mais pas à ce qu'on voie
 * juste après avoir supprimé un post depuis Facebook : cet appel comble
 * l'attente sans rien changer à la logique.
 */
export const verifyEventPosts = action({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
  },
  handler: async (ctx, args): Promise<{ checked: number; forgotten: number }> => {
    await ctx.runQuery(internal.social.assertCanRead, {});
    return await ctx.runAction(internal.social.reconcilePosts, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
    });
  },
});

export const assertCanRead = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    return true;
  },
});

/* ─── Instagram ───────────────────────────────────────────────────────────── */

/**
 * Comptes Instagram publiables.
 *
 * Un compte Instagram ne se publie qu'à travers la Page Facebook qui le porte,
 * avec le jeton de cette Page : la liste vient donc des Pages configurées, et
 * seules celles dont le rattachement est connu y figurent.
 */
export const listInstagramAccounts = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "publish");
    const pages = await ctx.db.query("socialFacebookPages").collect();
    return pages
      .filter((page) => page.active && page.instagramId)
      .map((page) => ({
        instagramId: page.instagramId!,
        username: page.instagramUsername ?? page.name,
        pageName: page.name,
      }))
      .sort((a, b) => a.username.localeCompare(b.username, "fr"));
  },
});

export const instagramTargets = internalQuery({
  args: { instagramIds: v.array(v.string()) },
  handler: async (ctx, { instagramIds }) => {
    const pages = await ctx.db.query("socialFacebookPages").collect();
    return pages
      .filter((page) => page.instagramId && instagramIds.includes(page.instagramId))
      .map((page) => ({
        instagramId: page.instagramId!,
        username: page.instagramUsername ?? page.name,
        accessToken: page.accessToken,
      }));
  },
});

export const setInstagramAccount = internalMutation({
  args: {
    pageId: v.string(),
    instagramId: v.optional(v.string()),
    instagramUsername: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("socialFacebookPages")
      .withIndex("by_pageId", (q) => q.eq("pageId", args.pageId))
      .unique();
    if (!page) return;
    await ctx.db.patch(page._id, {
      instagramId: args.instagramId,
      instagramUsername: args.instagramUsername,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Redécouvre les comptes Instagram rattachés aux Pages.
 *
 * Le rattachement se fait dans les réglages de la Page, hors de Mes Outils :
 * cette passe le constate plutôt que de le demander à quelqu'un de saisir.
 */
export const refreshInstagramAccounts = internalAction({
  args: {},
  handler: async (ctx): Promise<{ pages: number; linked: number }> => {
    const pages: Array<{ pageId: string; accessToken: string }> = await ctx.runQuery(
      internal.social.pageTokens,
      {},
    );
    let linked = 0;
    for (const page of pages) {
      try {
        const response = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/${page.pageId}` +
            `?fields=instagram_business_account{id,username}` +
            `&access_token=${encodeURIComponent(page.accessToken)}`,
        );
        const result = (await response.json()) as {
          instagram_business_account?: { id: string; username?: string };
        };
        const account = result.instagram_business_account;
        await ctx.runMutation(internal.social.setInstagramAccount, {
          pageId: page.pageId,
          instagramId: account?.id,
          instagramUsername: account?.username,
        });
        if (account?.id) linked += 1;
      } catch (error) {
        console.warn(
          `Compte Instagram de la Page ${page.pageId} illisible :`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    return { pages: pages.length, linked };
  },
});

export const pageTokens = internalQuery({
  args: {},
  handler: async (ctx) => {
    const pages = await ctx.db.query("socialFacebookPages").collect();
    return pages
      .filter((page) => page.active)
      .map((page) => ({ pageId: page.pageId, accessToken: page.accessToken }));
  },
});

/**
 * Publie un évènement sur un ou plusieurs comptes Instagram.
 *
 * Instagram exige au moins une image — un post texte n'y existe pas — et
 * publie en deux temps : on dépose d'abord un conteneur, on le publie ensuite.
 * L'API ne connaît pas la programmation, contrairement à Facebook : la
 * publication part immédiatement.
 *
 * Un compte en échec n'interrompt pas les autres : le rapport dit ce qui est
 * passé et ce qui a échoué, plutôt que de tout annuler sur un refus.
 */
export const publishEventToInstagram = action({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    instagramIds: v.array(v.string()),
    message: v.optional(v.string()),
    photoStorageIds: v.array(v.id("_storage")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ published: string[]; failed: Array<{ account: string; reason: string }> }> => {
    const author: { clerkId: string; name: string } = await ctx.runQuery(
      internal.social.assertCanPublish,
      {},
    );
    if (args.instagramIds.length === 0) throw new Error("Choisissez au moins un compte.");
    if (args.photoStorageIds.length === 0) {
      throw new Error("Instagram exige au moins une photo : un post texte n'y existe pas.");
    }

    const photoUrls = (
      await Promise.all(
        args.photoStorageIds.map((id) => ctx.storage.getUrl(id as Id<"_storage">)),
      )
    ).filter((url): url is string => Boolean(url));
    if (photoUrls.length === 0) throw new Error("Photos introuvables.");

    const targets: Array<{ instagramId: string; username: string; accessToken: string }> =
      await ctx.runQuery(internal.social.instagramTargets, {
        instagramIds: args.instagramIds,
      });

    const payload = await ctx.runQuery(internal.social.eventPayload, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
      pageId: "",
      skipPage: true,
    });
    const caption = args.message?.trim() || buildMessage(payload.event);

    const call = async (path: string, params: URLSearchParams) => {
      const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
        method: "POST",
        body: params,
      });
      const result = (await response.json()) as {
        id?: string;
        error?: { message?: string };
      };
      if (!response.ok || result.error || !result.id) {
        throw new Error(result.error?.message ?? `HTTP ${response.status}`);
      }
      return result.id;
    };

    const published: string[] = [];
    const failed: Array<{ account: string; reason: string }> = [];

    for (const target of targets) {
      try {
        let containerId: string;
        if (photoUrls.length === 1) {
          containerId = await call(
            `${target.instagramId}/media`,
            new URLSearchParams({
              access_token: target.accessToken,
              image_url: photoUrls[0],
              caption,
            }),
          );
        } else {
          // Carrousel : chaque image devient un élément, puis un conteneur les
          // rassemble. Instagram en accepte dix au plus.
          const children: string[] = [];
          for (const url of photoUrls.slice(0, 10)) {
            children.push(
              await call(
                `${target.instagramId}/media`,
                new URLSearchParams({
                  access_token: target.accessToken,
                  image_url: url,
                  is_carousel_item: "true",
                }),
              ),
            );
          }
          containerId = await call(
            `${target.instagramId}/media`,
            new URLSearchParams({
              access_token: target.accessToken,
              media_type: "CAROUSEL",
              children: children.join(","),
              caption,
            }),
          );
        }

        const postId = await call(
          `${target.instagramId}/media_publish`,
          new URLSearchParams({
            access_token: target.accessToken,
            creation_id: containerId,
          }),
        );

        await ctx.runMutation(internal.social.recordPost, {
          eventId: args.eventId,
          recycappEventId: args.recycappEventId,
          network: "instagram",
          pageId: target.instagramId,
          pageName: `@${target.username}`,
          postId,
          message: caption,
          withPhoto: true,
          authorClerkId: author.clerkId,
          authorName: author.name,
        });
        published.push(`@${target.username}`);
      } catch (error) {
        failed.push({
          account: `@${target.username}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (published.length === 0 && failed.length > 0) {
      throw new Error(`Instagram a refusé la publication : ${failed[0].reason}`);
    }
    return { published, failed };
  },
});
