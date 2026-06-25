import { internalMutation, mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  customerFullName,
  requireAdmin,
  requireCrmPermission,
  requireAnyCrmPermission,
  hasCrmPermission,
  isAerogommageComplete,
  isCollecteComplete,
  isArticleComplete,
  isVeloComplete,
  isLivraisonComplete,
  normalizeCustomer,
  titleCaseName,
} from "./lib";
import {
  aerogommageItem,
  collecteType,
  requestLostReason,
  requestType,
} from "./schema";
import { resolveProcess } from "./processes";
import { vehicleBusyReason } from "./fleet";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

const customerArg = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  phone: v.string(),
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
});

const addressArg = v.object({
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
});

const aerogommageOptionsArg = v.object({
  pickupAtHome: v.optional(v.boolean()),
  deliveryAtHome: v.optional(v.boolean()),
  pickupAddress: v.optional(addressArg),
  deliveryAddress: v.optional(addressArg),
});

/** Aperçu article pour l'email (carte avec image, prix, lien boutique). */
async function emailArticlePreview(ctx: MutationCtx, request: Doc<"requests">) {
  if (request.type === "article") {
    const articleId =
      request.article?.articleId ?? request.articles?.[0]?.articleId;
    if (!articleId) return undefined;
    const article = await ctx.db.get(articleId);
    if (!article) return undefined;
    return {
      title: article.title,
      price: article.price,
      condition: article.condition,
      imageStorageId: article.images?.[0]
        ? String(article.images[0])
        : undefined,
      articleId: String(articleId),
    };
  }
  if (request.type === "livraison" && request.livraison) {
    const l = request.livraison;
    if (!l.articleTitle) return undefined;
    return {
      title: l.articleTitle,
      price: l.articlePrice,
      condition: l.condition,
      imageStorageId: l.articlePhoto ? String(l.articlePhoto) : undefined,
    };
  }
  return undefined;
}

async function createNewRequestNotification(
  ctx: MutationCtx,
  args: {
    requestId: Id<"requests">;
    requestType: "aerogommage" | "collecte" | "article" | "velo" | "livraison";
    customerName: string;
  },
) {
  await ctx.db.insert("notifications", {
    kind: "new_request",
    title: "Nouvelle demande",
    requestId: args.requestId,
    requestType: args.requestType,
    customerName: args.customerName,
    read: false,
    createdAt: Date.now(),
  });

  // Email de confirmation au client (Resend).
  const request = await ctx.db.get(args.requestId);
  if (request?.customer.email) {
    await ctx.scheduler.runAfter(0, internal.emails.sendRequestConfirmation, {
      email: request.customer.email,
      name: customerFullName(request.customer),
      reference: request.reference ?? String(request._id).slice(-6),
      type: request.type,
      requestId: String(request._id),
      article: await emailArticlePreview(ctx, request),
    });
  }
}

async function generateReference(ctx: MutationCtx): Promise<string> {
  const all = await ctx.db.query("requests").collect();
  const n = all.length + 1;
  return n.toString().padStart(6, "0");
}

function requestArticleIds(request: {
  article?: { articleId: Id<"articles"> };
  articles?: Array<{ articleId: Id<"articles"> }>;
}) {
  return Array.from(
    new Set([
      ...(request.articles ?? []).map((article) => article.articleId),
      ...(request.article?.articleId ? [request.article.articleId] : []),
    ]),
  );
}

// ---------------------------------------------------------------------------
// Envois publics (depuis les formulaires clients) — pas d'authentification.
// ---------------------------------------------------------------------------

export const submitAerogommage = mutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    photos: v.array(v.id("_storage")),
    items: v.array(aerogommageItem),
    options: v.optional(aerogommageOptionsArg),
  },
  handler: async (ctx, { customer, comment, photos, items, options }) => {
    customer = normalizeCustomer(customer);
    const now = Date.now();
    const reference = await generateReference(ctx);
    const requestId = await ctx.db.insert("requests", {
      type: "aerogommage",
      stage: "nouveau",
      outcome: "open",
      requestOrigin: "external",
      complete: isAerogommageComplete(customer, items),
      processSteps: resolveProcess("aerogommage"),
      completedSteps: 0,
      site: "60", // Recyclerie 60 par défaut pour l'aérogommage.
      customer,
      userId: (await ctx.auth.getUserIdentity())?.subject,
      comment,
      photos,
      aerogommage: items,
      aerogommageOptions: options,
      createdAt: now,
      updatedAt: now,
      reference,
    });
    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "aerogommage",
      customerName: customerFullName(customer),
    });
    return requestId;
  },
});

export const submitCollecte = mutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    photos: v.array(v.id("_storage")),
    details: v.object({
      dismountable: v.optional(v.boolean()),
      reusableGoodCondition: v.optional(v.boolean()),
      sorted: v.optional(v.boolean()),
      noWaste: v.optional(v.boolean()),
      objectCategories: v.optional(v.array(v.string())),
      categoryPhotos: v.optional(
        v.array(
          v.object({
            category: v.string(),
            photos: v.array(v.id("_storage")),
          }),
        ),
      ),
      grosObjets: v.optional(v.array(v.string())),
      grosObjetsAutre: v.optional(v.string()),
      petitsObjets: v.optional(v.array(v.string())),
      petitsObjetsAutre: v.optional(v.string()),
      housingType: v.optional(v.string()),
      floors: v.optional(v.number()),
      dedicatedParking: v.optional(v.boolean()),
      parkingDistance: v.optional(v.number()),
      parkingUnknown: v.optional(v.boolean()),
      collectAddress: v.optional(
        v.object({
          address: v.optional(v.string()),
          postalCode: v.optional(v.string()),
          city: v.optional(v.string()),
        }),
      ),
    }),
  },
  handler: async (ctx, { customer, comment, photos, details }) => {
    customer = normalizeCustomer(customer);
    const now = Date.now();
    const reference = await generateReference(ctx);
    const requestId = await ctx.db.insert("requests", {
      type: "collecte",
      stage: "nouveau",
      outcome: "open",
      requestOrigin: "external",
      complete: isCollecteComplete(customer, details),
      // Arrive en « Collecte à définir » : sous-type choisi ensuite dans le CRM.
      collecteType: "indefini",
      processSteps: resolveProcess("collecte", "indefini"),
      completedSteps: 0,
      customer,
      userId: (await ctx.auth.getUserIdentity())?.subject,
      comment,
      photos,
      collecte: details,
      createdAt: now,
      updatedAt: now,
      reference,
    });
    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "collecte",
      customerName: customerFullName(customer),
    });
    return requestId;
  },
});

export const submitVelo = mutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    photos: v.array(v.id("_storage")),
    details: v.object({
      bikeType: v.optional(v.string()),
      service: v.optional(v.string()),
      brand: v.optional(v.string()),
      condition: v.optional(v.string()),
      description: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { customer, comment, photos, details }) => {
    customer = normalizeCustomer(customer);
    const now = Date.now();
    const reference = await generateReference(ctx);
    const requestId = await ctx.db.insert("requests", {
      type: "velo",
      stage: "nouveau",
      outcome: "open",
      requestOrigin: "external",
      complete: isVeloComplete(customer, details),
      processSteps: resolveProcess("velo"),
      completedSteps: 0,
      customer,
      userId: (await ctx.auth.getUserIdentity())?.subject,
      comment,
      photos,
      velo: details,
      createdAt: now,
      updatedAt: now,
      reference,
    });
    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "velo",
      customerName: customerFullName(customer),
    });
    return requestId;
  },
});

export const submitLivraison = mutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    articlePhoto: v.optional(v.id("_storage")),
    referencePhoto: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { customer, comment, articlePhoto, referencePhoto }) => {
    customer = normalizeCustomer(customer);
    const now = Date.now();
    const reference = await generateReference(ctx);
    const details = {
      deliveryAddress: {
        address: customer.address,
        postalCode: customer.postalCode,
        city: customer.city,
      },
      sameAsBilling: true,
      articlePhoto,
      referencePhoto,
    };
    const photos = [articlePhoto, referencePhoto].filter(
      (p): p is Id<"_storage"> => Boolean(p),
    );
    const requestId = await ctx.db.insert("requests", {
      type: "livraison",
      stage: "nouveau",
      outcome: "open",
      requestOrigin: "external",
      complete: isLivraisonComplete(customer, details),
      processSteps: resolveProcess("livraison"),
      completedSteps: 0,
      customer,
      userId: (await ctx.auth.getUserIdentity())?.subject,
      comment,
      photos,
      livraison: details,
      createdAt: now,
      updatedAt: now,
      reference,
    });
    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "livraison",
      customerName: customerFullName(customer),
    });
    return requestId;
  },
});

export const submitArticleReservation = mutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    articleId: v.id("articles"),
  },
  handler: async (ctx, { customer, comment, articleId }) => {
    customer = normalizeCustomer(customer);
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article introuvable.");
    if (article.status !== "disponible") {
      throw new Error("Cet article n'est plus disponible.");
    }
    const now = Date.now();
    const reference = await generateReference(ctx);
    // L'article passe en « réservé » dès la demande.
    await ctx.db.patch(articleId, { status: "reserve" });
    const requestId = await ctx.db.insert("requests", {
      type: "article",
      stage: "nouveau",
      outcome: "open",
      requestOrigin: "external",
      complete: isArticleComplete(customer),
      processSteps: resolveProcess("article"),
      completedSteps: 0,
      customer,
      userId: (await ctx.auth.getUserIdentity())?.subject,
      comment,
      photos: [],
      article: { articleId, articleTitle: article.title },
      articles: [{ articleId, articleTitle: article.title }],
      payment: {
        method: "especes",
        status: "pending",
        validated: false,
        captured: false,
      },
      createdAt: now,
      updatedAt: now,
      reference,
    });
    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "article",
      customerName: customerFullName(customer),
    });
    return requestId;
  },
});

export const submitArticleCartReservation = mutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    articleIds: v.array(v.id("articles")),
  },
  handler: async (ctx, { customer, comment, articleIds }) => {
    customer = normalizeCustomer(customer);
    const uniqueArticleIds = Array.from(new Set(articleIds));
    if (uniqueArticleIds.length === 0) {
      throw new Error("Ajoutez au moins un article au panier.");
    }
    const articles = [];
    for (const articleId of uniqueArticleIds) {
      const article = await ctx.db.get(articleId);
      if (!article) throw new Error("Un article du panier est introuvable.");
      if (article.status !== "disponible") {
        throw new Error(`"${article.title}" n'est plus disponible.`);
      }
      articles.push({ articleId, articleTitle: article.title });
    }

    const now = Date.now();
    const reference = await generateReference(ctx);
    for (const articleId of uniqueArticleIds) {
      await ctx.db.patch(articleId, { status: "reserve" });
    }

    const requestId = await ctx.db.insert("requests", {
      type: "article",
      stage: "nouveau",
      outcome: "open",
      requestOrigin: "external",
      complete: isArticleComplete(customer),
      processSteps: resolveProcess("article"),
      completedSteps: 0,
      customer,
      userId: (await ctx.auth.getUserIdentity())?.subject,
      comment,
      photos: [],
      article: articles[0],
      articles,
      payment: {
        method: "especes",
        status: "pending",
        validated: false,
        captured: false,
      },
      createdAt: now,
      updatedAt: now,
      reference,
    });
    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "article",
      customerName: customerFullName(customer),
    });
    return requestId;
  },
});

export const createPublicStripeCheckoutDraft = internalMutation({
  args: {
    customer: customerArg,
    comment: v.optional(v.string()),
    articleIds: v.array(v.id("articles")),
  },
  handler: async (ctx, { customer, comment, articleIds }) => {
    customer = normalizeCustomer(customer);
    const uniqueArticleIds = Array.from(new Set(articleIds));
    if (uniqueArticleIds.length === 0) {
      throw new Error("Ajoutez au moins un article au panier.");
    }

    let total = 0;
    for (const articleId of uniqueArticleIds) {
      const article = await ctx.db.get(articleId);
      if (!article) throw new Error("Un article du panier est introuvable.");
      if (article.status !== "disponible") {
        throw new Error(`"${article.title}" n'est plus disponible.`);
      }
      total += article.price;
    }

    const draftId = await ctx.db.insert("publicStripeCheckoutDrafts", {
      articleIds: uniqueArticleIds,
      customer,
      comment,
      total,
      status: "pending",
      createdAt: Date.now(),
    });
    return { draftId, total };
  },
});

export const attachStripeSessionToPublicDraft = internalMutation({
  args: {
    draftId: v.id("publicStripeCheckoutDrafts"),
    stripeSessionId: v.string(),
  },
  handler: async (ctx, { draftId, stripeSessionId }) => {
    await ctx.db.patch(draftId, { stripeSessionId });
    return null;
  },
});

export const finalizePublicStripeCheckout = internalMutation({
  args: {
    draftId: v.id("publicStripeCheckoutDrafts"),
    stripeSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, { draftId, stripeSessionId, stripePaymentIntentId }) => {
    const draft = await ctx.db.get(draftId);
    if (!draft) throw new Error("Paiement en ligne introuvable.");

    if (draft.status === "completed" && draft.requestId) {
      return { requestId: draft.requestId };
    }

    if (draft.stripeSessionId && draft.stripeSessionId !== stripeSessionId) {
      throw new Error("Cette session Stripe ne correspond pas au panier en cours.");
    }

    const articles = [];
    for (const articleId of draft.articleIds) {
      const article = await ctx.db.get(articleId);
      if (!article) throw new Error("Un article payé est introuvable.");
      if (article.status !== "disponible") {
        throw new Error(`"${article.title}" n'est plus disponible.`);
      }
      articles.push({ articleId, articleTitle: article.title });
    }

    const now = Date.now();
    const reference = await generateReference(ctx);
    for (const articleId of draft.articleIds) {
      await ctx.db.patch(articleId, { status: "vendu" });
    }

    const steps = resolveProcess("article");
    const requestId = await ctx.db.insert("requests", {
      type: "article",
      stage: "nouveau",
      outcome: "gagnee",
      requestOrigin: "external",
      complete: isArticleComplete(draft.customer),
      processSteps: steps,
      completedSteps: steps.length,
      customer: draft.customer,
      comment: draft.comment || undefined,
      photos: [],
      article: articles[0],
      articles,
      payment: {
        method: "cb",
        status: "paid",
        validated: true,
        captured: true,
        provider: "stripe",
        stripeSessionId,
        stripePaymentIntentId,
        paidAt: now,
      },
      createdAt: now,
      updatedAt: now,
      reference,
    });

    await createNewRequestNotification(ctx, {
      requestId,
      requestType: "article",
      customerName: customerFullName(draft.customer),
    });

    await ctx.db.patch(draftId, {
      stripeSessionId,
      stripePaymentIntentId,
      status: "completed",
      requestId,
      completedAt: Date.now(),
    });

    return { requestId };
  },
});

// ---------------------------------------------------------------------------
// CRM (protégé)
// ---------------------------------------------------------------------------

export const list = query({
  args: {
    type: v.optional(requestType),
  },
  handler: async (ctx, { type }) => {
    await requireCrmPermission(ctx, "demandes", "read");
    const all = type
      ? await ctx.db
          .query("requests")
          .withIndex("by_type", (q) => q.eq("type", type))
          .order("desc")
          .collect()
      : await ctx.db.query("requests").order("desc").collect();
    return all.map((r) => ({ ...r, customer: normalizeCustomer(r.customer) }));
  },
});

/** Liste légère des demandes pour le sélecteur « Assigner à une demande ». */
export const listForPicker = query({
  args: {},
  handler: async (ctx) => {
    await requireAnyCrmPermission(ctx, [
      ["documents", "share"],
      ["demandes", "read"],
    ]);
    const requests = await ctx.db.query("requests").order("desc").take(500);
    return requests.map((r) => {
      const c = normalizeCustomer(r.customer);
      return {
        _id: r._id,
        reference: r.reference ?? String(r._id).slice(-6),
        type: r.type,
        collecteType: r.collecteType ?? null,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        city: c.city ?? null,
        createdAt: r.createdAt,
      };
    });
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    // Badge de navigation : renvoie 0 sans erreur si l'utilisateur n'a pas
    // accès aux demandes (la query est montée en permanence dans le layout).
    if (!(await hasCrmPermission(ctx, "demandes", "read"))) {
      return { complete: 0 };
    }
    const requests = await ctx.db.query("requests").collect();
    return {
      complete: requests.filter(
        (request) => request.complete && request.outcome === "open",
      ).length,
    };
  },
});

export const get = query({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, "demandes", "read");
    const request = await ctx.db.get(id);
    if (!request) return null;
    const photoUrls = await Promise.all(
      request.photos.map((p) => ctx.storage.getUrl(p)),
    );
    const beforePhotoUrls = await Promise.all(
      (request.beforePhotos ?? []).map((p) => ctx.storage.getUrl(p)),
    );
    const afterPhotoUrls = await Promise.all(
      (request.afterPhotos ?? []).map((p) => ctx.storage.getUrl(p)),
    );
    // Résout les URLs des photos rattachées à chaque objet d'aérogommage.
    const aerogommagePhotos = await Promise.all(
      (request.aerogommage ?? []).map(async (item) =>
        (
          await Promise.all((item.photos ?? []).map((p) => ctx.storage.getUrl(p)))
        ).filter((u): u is string => u !== null),
      ),
    );
    // Résout les URLs des photos de collecte, groupées par catégorie.
    const collecteCategoryPhotos = await Promise.all(
      (request.collecte?.categoryPhotos ?? []).map(async (entry) => ({
        category: entry.category,
        urls: (
          await Promise.all(entry.photos.map((p) => ctx.storage.getUrl(p)))
        ).filter((u): u is string => u !== null),
      })),
    );
    // Photos de la demande de livraison (article + référence, séparées).
    const livraisonArticleUrl = request.livraison?.articlePhoto
      ? await ctx.storage.getUrl(request.livraison.articlePhoto)
      : null;
    const livraisonReferenceUrl = request.livraison?.referencePhoto
      ? await ctx.storage.getUrl(request.livraison.referencePhoto)
      : null;
    return {
      ...request,
      customer: normalizeCustomer(request.customer),
      photoUrls: photoUrls.filter((u): u is string => u !== null),
      beforePhotoUrls: beforePhotoUrls.filter((u): u is string => u !== null),
      afterPhotoUrls: afterPhotoUrls.filter((u): u is string => u !== null),
      aerogommagePhotos,
      collecteCategoryPhotos,
      livraisonArticleUrl,
      livraisonReferenceUrl,
    };
  },
});

export const setOutcome = mutation({
  args: {
    id: v.id("requests"),
    outcome: v.union(
      v.literal("open"),
      v.literal("gagnee"),
      v.literal("perdue"),
    ),
    lostReason: v.optional(v.union(requestLostReason, v.null())),
    lostReasonDetails: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { id, outcome, lostReason, lostReasonDetails }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const request = await ctx.db.get(id);
    if (!request) throw new Error("Demande introuvable.");
    await ctx.db.patch(id, {
      outcome,
      lostReason: outcome === "perdue" ? (lostReason ?? undefined) : undefined,
      lostReasonDetails:
        outcome === "perdue" ? (lostReasonDetails ?? undefined) : undefined,
      updatedAt: Date.now(),
    });
    if (request.type === "article") {
      const articleStatus =
        outcome === "gagnee"
          ? "vendu"
          : outcome === "perdue"
            ? "disponible"
            : "reserve";
      for (const articleId of requestArticleIds(request)) {
        await ctx.db.patch(articleId, { status: articleStatus });
      }
    }
  },
});

export const setComplete = mutation({
  args: {
    id: v.id("requests"),
    complete: v.boolean(),
  },
  handler: async (ctx, { id, complete }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    await ctx.db.patch(id, { complete, updatedAt: Date.now() });
  },
});

export const backfillRequestOrigins = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const requests = await ctx.db.query("requests").collect();
    let updated = 0;

    for (const request of requests) {
      if (request.requestOrigin !== undefined) continue;
      await ctx.db.patch(request._id, { requestOrigin: "external" });
      updated += 1;
    }

    return { updated };
  },
});

/**
 * Harmonise les noms/prénoms historiques dans tout l'écosystème client/CRM.
 * Couvre : demandes, profils clients, notifications et noms d'expéditeur client.
 */
export const backfillCustomerNameFormatting = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    let requestsUpdated = 0;
    let usersUpdated = 0;
    let notificationsUpdated = 0;
    let messagesUpdated = 0;

    const requests = await ctx.db.query("requests").collect();
    for (const request of requests) {
      const customer = normalizeCustomer(request.customer);
      if (
        customer.firstName !== request.customer.firstName ||
        customer.lastName !== request.customer.lastName
      ) {
        await ctx.db.patch(request._id, {
          customer,
          updatedAt: Date.now(),
        });
        requestsUpdated += 1;
      }
    }

    const users = await ctx.db.query("users").collect();
    for (const user of users) {
      const firstName = user.firstName ? titleCaseName(user.firstName) : user.firstName;
      const lastName = user.lastName ? titleCaseName(user.lastName) : user.lastName;
      if (firstName !== user.firstName || lastName !== user.lastName) {
        await ctx.db.patch(user._id, {
          firstName,
          lastName,
          updatedAt: Date.now(),
        });
        usersUpdated += 1;
      }
    }

    const notifications = await ctx.db.query("notifications").collect();
    for (const notification of notifications) {
      const customerName = titleCaseName(notification.customerName);
      if (customerName !== notification.customerName) {
        await ctx.db.patch(notification._id, { customerName });
        notificationsUpdated += 1;
      }
    }

    const messages = await ctx.db.query("messages").collect();
    for (const message of messages) {
      if (message.senderRole !== "client") continue;
      const senderName = titleCaseName(message.senderName);
      if (senderName !== message.senderName) {
        await ctx.db.patch(message._id, { senderName });
        messagesUpdated += 1;
      }
    }

    return {
      requestsUpdated,
      usersUpdated,
      notificationsUpdated,
      messagesUpdated,
    };
  },
});

/**
 * Met à jour les champs de gestion interne (onglet Gestion).
 * Une valeur `null` efface le champ ; un champ absent est laissé inchangé.
 */
export const patchManagement = mutation({
  args: {
    id: v.id("requests"),
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    assignedTo: v.optional(v.union(v.id("teamMembers"), v.null())),
    estimatedHours: v.optional(v.union(v.number(), v.null())),
    actualHours: v.optional(v.union(v.number(), v.null())),
    quoteAmount: v.optional(v.union(v.number(), v.null())),
    quoteDetails: v.optional(v.union(v.string(), v.null())),
    visitNeeded: v.optional(v.union(v.boolean(), v.null())),
    assignedVehicle: v.optional(v.union(v.id("vehicles"), v.null())),
    beforePhotos: v.optional(v.array(v.id("_storage"))),
    afterPhotos: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.site !== undefined) patch.site = args.site;
    if (args.assignedTo !== undefined)
      patch.assignedTo = args.assignedTo ?? undefined;
    if (args.assignedVehicle !== undefined) {
      if (args.assignedVehicle) {
        const request = await ctx.db.get(args.id);
        const date = request?.scheduledDate ?? Date.now();
        const reason = await vehicleBusyReason(ctx, args.assignedVehicle, date, {
          excludeRequestId: args.id,
        });
        if (reason) {
          throw new Error(`Véhicule indisponible à cette date : ${reason}`);
        }
      }
      patch.assignedVehicle = args.assignedVehicle ?? undefined;
    }
    if (args.estimatedHours !== undefined)
      patch.estimatedHours = args.estimatedHours ?? undefined;
    if (args.actualHours !== undefined)
      patch.actualHours = args.actualHours ?? undefined;
    if (args.quoteAmount !== undefined)
      patch.quoteAmount = args.quoteAmount ?? undefined;
    if (args.quoteDetails !== undefined)
      patch.quoteDetails = args.quoteDetails ?? undefined;
    if (args.visitNeeded !== undefined)
      patch.visitNeeded = args.visitNeeded ?? undefined;
    if (args.beforePhotos !== undefined) patch.beforePhotos = args.beforePhotos;
    if (args.afterPhotos !== undefined) patch.afterPhotos = args.afterPhotos;
    await ctx.db.patch(args.id, patch);
  },
});

/** Planifie (ou déplanifie) la prestation pour le calendrier. */
export const schedule = mutation({
  args: {
    id: v.id("requests"),
    scheduledDate: v.optional(v.number()),
    assignedVehicle: v.optional(v.union(v.id("vehicles"), v.null())),
  },
  handler: async (ctx, { id, scheduledDate, assignedVehicle }) => {
    await requireAnyCrmPermission(ctx, [["demandes", "update"], ["calendrier", "update"]]);
    const previous = await ctx.db.get(id);
    const patch: Record<string, unknown> = {
      scheduledDate,
      updatedAt: Date.now(),
    };
    if (assignedVehicle !== undefined) {
      if (assignedVehicle && scheduledDate) {
        const reason = await vehicleBusyReason(
          ctx,
          assignedVehicle,
          scheduledDate,
          { excludeRequestId: id },
        );
        if (reason) {
          throw new Error(`Véhicule indisponible à cette date : ${reason}`);
        }
      }
      patch.assignedVehicle = assignedVehicle ?? undefined;
    }
    await ctx.db.patch(id, patch);
    // Prévenir le client par email quand une date est (re)programmée.
    if (
      scheduledDate &&
      scheduledDate !== previous?.scheduledDate &&
      previous?.customer.email
    ) {
      await ctx.scheduler.runAfter(0, internal.emails.sendScheduled, {
        email: previous.customer.email,
        name: customerFullName(previous.customer),
        reference: previous.reference ?? String(previous._id).slice(-6),
        type: previous.type,
        requestId: String(previous._id),
        date: scheduledDate,
        article: await emailArticlePreview(ctx, previous),
      });
    }
  },
});

/** Envoie au client un email lui demandant d'importer des photos (Resend). */
export const requestPhotos = mutation({
  args: { id: v.id("requests"), note: v.optional(v.string()) },
  handler: async (ctx, { id, note }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const request = await ctx.db.get(id);
    if (!request) throw new Error("Demande introuvable.");
    if (!request.customer.email) {
      throw new Error("Ce client n'a pas d'adresse email renseignée.");
    }
    await ctx.scheduler.runAfter(0, internal.emails.sendPhotoRequest, {
      email: request.customer.email,
      name: customerFullName(request.customer),
      reference: request.reference ?? String(request._id).slice(-6),
      type: request.type,
      requestId: String(request._id),
      note: note?.trim() || undefined,
    });
    return { ok: true };
  },
});

/**
 * Coche l'étape suivante du process (une seule à la fois, pas de saut).
 * Quand la dernière étape est cochée, la demande passe automatiquement en gagnée.
 */
export const advanceProcess = mutation({
  args: { id: v.id("requests"), by: v.optional(v.string()) },
  handler: async (ctx, { id, by }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Demande introuvable.");
    const steps = r.processSteps ?? [];
    const current = r.completedSteps ?? 0;
    if (current >= steps.length) return;
    const completedSteps = current + 1;
    const done = completedSteps >= steps.length && completedSteps > 0;
    const log = (r.processLog ?? []).filter((e) => e.step < current);
    log.push({ step: current, by: by?.trim() || "Inconnu", at: Date.now() });
    await ctx.db.patch(id, {
      completedSteps,
      processLog: log,
      outcome: done ? "gagnee" : "open",
      updatedAt: Date.now(),
    });
    if (done && r.type === "article") {
      for (const articleId of requestArticleIds(r)) {
        await ctx.db.patch(articleId, { status: "vendu" });
      }
    }
  },
});

/** Décoche la dernière étape cochée (retour en arrière d'une étape). */
export const retreatProcess = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Demande introuvable.");
    const current = r.completedSteps ?? 0;
    if (current <= 0) return;
    const completedSteps = current - 1;
    const log = (r.processLog ?? []).filter((e) => e.step < completedSteps);
    await ctx.db.patch(id, {
      completedSteps,
      processLog: log,
      // Si la demande était gagnée par la dernière étape, on la rouvre.
      outcome: r.outcome === "gagnee" ? "open" : r.outcome,
      updatedAt: Date.now(),
    });
    if (r.outcome === "gagnee" && r.type === "article") {
      for (const articleId of requestArticleIds(r)) {
        await ctx.db.patch(articleId, { status: "reserve" });
      }
    }
  },
});

export const addProcessNote = mutation({
  args: {
    id: v.id("requests"),
    step: v.number(),
    body: v.string(),
    by: v.optional(v.string()),
  },
  handler: async (ctx, { id, step, body, by }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const request = await ctx.db.get(id);
    if (!request) throw new Error("Demande introuvable.");
    if (step < 0 || step >= request.processSteps.length) {
      throw new Error("Étape de process invalide.");
    }

    const trimmed = body.trim();
    if (!trimmed) {
      throw new Error("Le commentaire ne peut pas être vide.");
    }

    await ctx.db.patch(id, {
      processNotes: [
        ...(request.processNotes ?? []),
        {
          step,
          by: by?.trim() || "Inconnu",
          at: Date.now(),
          body: trimmed,
        },
      ],
      updatedAt: Date.now(),
    });
  },
});

/** Définit le sous-type d'une collecte (C1/C2/C3) → recalcule le process. */
export const setCollecteType = mutation({
  args: { id: v.id("requests"), collecteType },
  handler: async (ctx, { id, collecteType: ct }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Demande introuvable.");
    if (r.type !== "collecte") throw new Error("Type de demande invalide.");
    await ctx.db.patch(id, {
      collecteType: ct,
      processSteps: resolveProcess("collecte", ct),
      completedSteps: 0,
      processLog: [],
      processNotes: [],
      outcome: "open",
      updatedAt: Date.now(),
    });
  },
});

/** Met à jour les coordonnées du client d'une demande (onglet Client). */
export const updateCustomer = mutation({
  args: { id: v.id("requests"), customer: customerArg },
  handler: async (ctx, { id, customer }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    await ctx.db.patch(id, { customer: normalizeCustomer(customer), updatedAt: Date.now() });
  },
});

/**
 * Crée une demande directement depuis le CRM (par un membre de l'équipe).
 * Même logique que les mutations publiques, avec requestOrigin: "internal".
 */
export const createInternal = mutation({
  args: {
    type: requestType,
    customer: customerArg,
    comment: v.optional(v.string()),
    // Aérogommage
    items: v.optional(v.array(aerogommageItem)),
    aerogommageOptions: v.optional(aerogommageOptionsArg),
    // Collecte
    collecteDetails: v.optional(
      v.object({
        dismountable: v.optional(v.boolean()),
        reusableGoodCondition: v.optional(v.boolean()),
        sorted: v.optional(v.boolean()),
        noWaste: v.optional(v.boolean()),
        objectCategories: v.optional(v.array(v.string())),
        categoryPhotos: v.optional(
          v.array(
            v.object({
              category: v.string(),
              photos: v.array(v.id("_storage")),
            }),
          ),
        ),
        grosObjets: v.optional(v.array(v.string())),
        grosObjetsAutre: v.optional(v.string()),
        petitsObjets: v.optional(v.array(v.string())),
        petitsObjetsAutre: v.optional(v.string()),
        housingType: v.optional(v.string()),
        floors: v.optional(v.number()),
        dedicatedParking: v.optional(v.boolean()),
        parkingDistance: v.optional(v.number()),
        parkingUnknown: v.optional(v.boolean()),
        collectAddress: v.optional(
          v.object({
            address: v.optional(v.string()),
            postalCode: v.optional(v.string()),
            city: v.optional(v.string()),
          }),
        ),
      }),
    ),
    // Article
    articleId: v.optional(v.id("articles")),
    // Livraison
    livraisonDetails: v.optional(
      v.object({
        deliveryAddress: v.optional(addressArg),
        sameAsBilling: v.optional(v.boolean()),
        articlePhoto: v.optional(v.id("_storage")),
        referencePhoto: v.optional(v.id("_storage")),
        articleTitle: v.optional(v.string()),
        category: v.optional(v.string()),
        subcategory: v.optional(v.string()),
        condition: v.optional(v.string()),
        reference: v.optional(v.string()),
        referenceFromBarcode: v.optional(v.boolean()),
        articlePrice: v.optional(v.number()),
        acompte: v.optional(v.number()),
        distanceKm: v.optional(v.number()),
        deliveryFee: v.optional(v.number()),
        suggestedSlot: v.optional(
          v.object({
            requestReference: v.optional(v.string()),
            scheduledDate: v.optional(v.number()),
            distanceKm: v.optional(v.number()),
            city: v.optional(v.string()),
            discount: v.optional(v.number()),
            reducedDeliveryFee: v.optional(v.number()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "demandes", "create");
    args = { ...args, customer: normalizeCustomer(args.customer) };
    const now = Date.now();
    const reference = await generateReference(ctx);
    const name = customerFullName(args.customer);

    if (args.type === "aerogommage") {
      const items = args.items ?? [];
      const id = await ctx.db.insert("requests", {
        type: "aerogommage",
        stage: "nouveau",
        outcome: "open",
        requestOrigin: "internal",
        complete: isAerogommageComplete(args.customer, items),
        processSteps: resolveProcess("aerogommage"),
        completedSteps: 0,
        site: "60",
        customer: args.customer,
        comment: args.comment,
        photos: [],
        aerogommage: items,
        aerogommageOptions: args.aerogommageOptions,
        createdAt: now,
        updatedAt: now,
        reference,
      });
      await createNewRequestNotification(ctx, { requestId: id, requestType: "aerogommage", customerName: name });
      return id;
    }

    if (args.type === "collecte") {
      const details = args.collecteDetails ?? {};
      const id = await ctx.db.insert("requests", {
        type: "collecte",
        stage: "nouveau",
        outcome: "open",
        requestOrigin: "internal",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        complete: isCollecteComplete(args.customer, details as any),
        collecteType: "indefini",
        processSteps: resolveProcess("collecte", "indefini"),
        completedSteps: 0,
        customer: args.customer,
        comment: args.comment,
        photos: [],
        collecte: details,
        createdAt: now,
        updatedAt: now,
        reference,
      });
      await createNewRequestNotification(ctx, { requestId: id, requestType: "collecte", customerName: name });
      return id;
    }

    if (args.type === "article") {
      const articleId = args.articleId;
      if (!articleId) throw new Error("articleId requis pour une demande boutique.");
      const article = await ctx.db.get(articleId);
      if (!article) throw new Error("Article introuvable.");
      if (article.status !== "disponible") throw new Error("Cet article n'est plus disponible.");
      await ctx.db.patch(articleId, { status: "reserve" });
      const id = await ctx.db.insert("requests", {
        type: "article",
        stage: "nouveau",
        outcome: "open",
        requestOrigin: "internal",
        complete: isArticleComplete(args.customer),
        processSteps: resolveProcess("article"),
        completedSteps: 0,
        customer: args.customer,
        comment: args.comment,
        photos: [],
        article: { articleId, articleTitle: article.title },
        articles: [{ articleId, articleTitle: article.title }],
        createdAt: now,
        updatedAt: now,
        reference,
      });
      await createNewRequestNotification(ctx, { requestId: id, requestType: "article", customerName: name });
      return id;
    }

    if (args.type === "livraison") {
      const details = args.livraisonDetails ?? {};
      const photos = [details.articlePhoto, details.referencePhoto].filter(
        (p): p is Id<"_storage"> => Boolean(p),
      );
      const id = await ctx.db.insert("requests", {
        type: "livraison",
        stage: "nouveau",
        outcome: "open",
        requestOrigin: "internal",
        complete: isLivraisonComplete(args.customer, details),
        processSteps: resolveProcess("livraison"),
        completedSteps: 0,
        customer: args.customer,
        comment: args.comment,
        photos,
        livraison: details,
        createdAt: now,
        updatedAt: now,
        reference,
      });
      await createNewRequestNotification(ctx, { requestId: id, requestType: "livraison", customerName: name });
      return id;
    }

    throw new Error("Type de demande non pris en charge.");
  },
});

/** Demandes planifiées sur une période (pour le calendrier). */
export const scheduled = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    await requireCrmPermission(ctx, "calendrier", "read");
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_scheduledDate", (q) =>
        q.gte("scheduledDate", from).lte("scheduledDate", to),
      )
      .collect();
    return requests.map((request) => ({
      ...request,
      customer: normalizeCustomer(request.customer),
    }));
  },
});
