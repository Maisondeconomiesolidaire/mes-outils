import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  MutationCtx,
} from "./_generated/server";
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
  normalizeEmail,
  requireUser,
  titleCaseName,
} from "./lib";
import {
  aerogommageItem,
  collecteType,
  requestLostReason,
  requestType,
} from "./schema";
import { isAwaitingInvoicePayment, resolveProcess } from "./processes";
import { vehicleBusyReason } from "./fleet";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

/**
 * Fusionne le dernier modificateur (`actorName`) pour chaque champ modifié,
 * afin d'afficher « Modifié par … » sous chaque champ du CRM.
 */
function withFieldEdits(
  existing: Record<string, { by: string; at: number }> | undefined,
  keys: string[],
  actorName: string | undefined,
): Record<string, { by: string; at: number }> | undefined {
  if (keys.length === 0) return existing;
  const by = actorName?.trim() || "Inconnu";
  const at = Date.now();
  const next = { ...(existing ?? {}) };
  for (const key of keys) next[key] = { by, at };
  return next;
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setPatchIfChanged<T>(
  patch: Record<string, unknown>,
  changed: string[],
  key: string,
  currentValue: T,
  nextValue: T,
  trackFieldEdit = true,
) {
  if (sameValue(currentValue, nextValue)) return;
  patch[key] = nextValue;
  if (trackFieldEdit) changed.push(key);
}

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

  // Email à l'équipe recyclerie — décalé pour rester sous la limite Resend
  // (2 req/s) avec l'email client. E. Carette est ajouté uniquement pour
  // les demandes d'aérogommage par l'action d'envoi.
  if (request) {
    await ctx.scheduler.runAfter(1200, internal.emails.sendNewRequestToStaff, {
      type: request.type,
      reference: request.reference ?? String(request._id).slice(-6),
      customerName: customerFullName(request.customer),
      article: await emailArticlePreview(ctx, request),
    });
  }
}

async function generateReference(ctx: MutationCtx): Promise<string> {
  const all = await ctx.db.query("requests").collect();
  const n = all.length + 1;
  return n.toString().padStart(6, "0");
}

async function upsertRequestCustomer(
  ctx: MutationCtx,
  customerInput: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address?: string;
    postalCode?: string;
    city?: string;
  },
  sourcePath: string,
) {
  const customer = normalizeCustomer(customerInput);
  const email = normalizeEmail(customer.email);
  const now = Date.now();

  const [existingUser, existingCrmCustomer, identity] = await Promise.all([
    email
      ? ctx.db
          .query("users")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first()
      : null,
    email
      ? ctx.db
          .query("crmCustomers")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first()
      : null,
    ctx.auth.getUserIdentity(),
  ]);

  if (existingUser) {
    await ctx.db.patch(existingUser._id, {
      firstName: titleCaseName(customer.firstName),
      lastName: titleCaseName(customer.lastName),
      phone: customer.phone,
      address: customer.address,
      postalCode: customer.postalCode,
      city: customer.city,
      updatedAt: now,
    });
  }

  if (existingCrmCustomer) {
    await ctx.db.patch(existingCrmCustomer._id, {
      firstName: titleCaseName(customer.firstName),
      lastName: titleCaseName(customer.lastName),
      phone: customer.phone,
      address: customer.address,
      postalCode: customer.postalCode,
      city: customer.city,
      updatedAt: now,
    });
  } else if (email) {
    await ctx.db.insert("crmCustomers", {
      source: "public:request",
      sourceId: `${sourcePath}:${email}`,
      firstName: titleCaseName(customer.firstName),
      lastName: titleCaseName(customer.lastName),
      email,
      phone: customer.phone,
      address: customer.address,
      postalCode: customer.postalCode,
      city: customer.city,
      raw: [],
      createdAt: now,
      updatedAt: now,
    });
  }

  const signedInEmail = normalizeEmail(identity?.email);
  const signedInUserId =
    signedInEmail && signedInEmail === email ? identity?.subject : undefined;

  return {
    customer,
    userId: existingUser?.clerkId ?? signedInUserId,
  };
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

const PERMANENT_DELETE_EMAIL = "lahmerselim@gmail.com";

async function requirePermanentDeleteAccess(ctx: MutationCtx) {
  const identity = await requireUser(ctx);
  if (identity.email?.trim().toLowerCase() !== PERMANENT_DELETE_EMAIL) {
    throw new Error("Suppression définitive non autorisée.");
  }
  return identity;
}

function requestStorageIds(request: Doc<"requests">) {
  const ids = new Set<Id<"_storage">>();
  for (const id of request.photos ?? []) ids.add(id);
  for (const id of request.beforePhotos ?? []) ids.add(id);
  for (const id of request.afterPhotos ?? []) ids.add(id);
  for (const item of request.aerogommage ?? []) {
    for (const id of item.photos ?? []) ids.add(id);
    for (const id of item.beforePhotos ?? []) ids.add(id);
    for (const id of item.afterPhotos ?? []) ids.add(id);
  }
  for (const entry of request.collecte?.categoryPhotos ?? []) {
    for (const id of entry.photos ?? []) ids.add(id);
  }
  if (request.livraison?.articlePhoto) ids.add(request.livraison.articlePhoto);
  if (request.livraison?.referencePhoto) ids.add(request.livraison.referencePhoto);
  return [...ids];
}

async function deleteStorageBestEffort(ctx: MutationCtx, ids: Id<"_storage">[]) {
  let deleted = 0;
  for (const id of ids) {
    try {
      await ctx.storage.delete(id);
      deleted++;
    } catch {
      // Le fichier peut déjà avoir été retiré ou être partagé ailleurs.
    }
  }
  return deleted;
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
    await requireUser(ctx);
    const resolvedCustomer = await upsertRequestCustomer(
      ctx,
      customer,
      "/aerogommage",
    );
    customer = resolvedCustomer.customer;
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
      userId: resolvedCustomer.userId,
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
    await requireUser(ctx);
    const resolvedCustomer = await upsertRequestCustomer(
      ctx,
      customer,
      "/collecte",
    );
    customer = resolvedCustomer.customer;
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
      userId: resolvedCustomer.userId,
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
    await requireUser(ctx);
    const resolvedCustomer = await upsertRequestCustomer(
      ctx,
      customer,
      "/velo",
    );
    customer = resolvedCustomer.customer;
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
      userId: resolvedCustomer.userId,
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
    await requireUser(ctx);
    const resolvedCustomer = await upsertRequestCustomer(
      ctx,
      customer,
      "/livraison",
    );
    customer = resolvedCustomer.customer;
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
      userId: resolvedCustomer.userId,
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
    const resolvedCustomer = await upsertRequestCustomer(
      ctx,
      customer,
      "/boutique",
    );
    customer = resolvedCustomer.customer;
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
      userId: resolvedCustomer.userId,
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
    const resolvedCustomer = await upsertRequestCustomer(
      ctx,
      customer,
      "/boutique/panier",
    );
    customer = resolvedCustomer.customer;
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
      userId: resolvedCustomer.userId,
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
    const openRequests = await ctx.db
      .query("requests")
      .withIndex("by_outcome", (q) => q.eq("outcome", "open"))
      .collect();
    return {
      complete: openRequests.filter((request) => request.complete).length,
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
    const aerogommageBeforePhotos = await Promise.all(
      (request.aerogommage ?? []).map(async (item) =>
        (
          await Promise.all((item.beforePhotos ?? []).map((p) => ctx.storage.getUrl(p)))
        ).filter((u): u is string => u !== null),
      ),
    );
    const aerogommageAfterPhotos = await Promise.all(
      (request.aerogommage ?? []).map(async (item) =>
        (
          await Promise.all((item.afterPhotos ?? []).map((p) => ctx.storage.getUrl(p)))
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
      aerogommageBeforePhotos,
      aerogommageAfterPhotos,
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

export const deleteForever = mutation({
  args: { id: v.id("requests") },
  handler: async (ctx, { id }) => {
    await requirePermanentDeleteAccess(ctx);
    const request = await ctx.db.get(id);
    if (!request) return { deleted: false };

    let messagesDeleted = 0;
    let notificationsDeleted = 0;
    let documentsDeleted = 0;
    let trackingLinksDeleted = 0;
    let tourneeStopsRemoved = 0;
    let articleReservationsReleased = 0;

    const requestPhotoIds = requestStorageIds(request);

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_requestId", (q) => q.eq("requestId", id))
      .collect();
    for (const message of messages) {
      await ctx.db.delete(message._id);
      messagesDeleted++;
    }

    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_requestId", (q) => q.eq("requestId", id))
      .collect();
    for (const notification of notifications) {
      await ctx.db.delete(notification._id);
      notificationsDeleted++;
    }

    const requestDocuments = await ctx.db
      .query("requestDocuments")
      .withIndex("by_requestId", (q) => q.eq("requestId", id))
      .collect();
    const documentStorageIds: Id<"_storage">[] = [];
    for (const document of requestDocuments) {
      if (!document.sourceDocumentId) documentStorageIds.push(document.storageId);
      await ctx.db.delete(document._id);
      documentsDeleted++;
    }

    const trackingLinks = await ctx.db
      .query("tourneeTrackingLinks")
      .withIndex("by_requestId", (q) => q.eq("requestId", id))
      .collect();
    for (const link of trackingLinks) {
      await ctx.db.delete(link._id);
      trackingLinksDeleted++;
    }

    const tournees = await ctx.db.query("tournees").take(500);
    for (const tournee of tournees) {
      const stops = tournee.stops.filter((stop) => {
        if (stop.requestId !== id) return true;
        tourneeStopsRemoved++;
        return false;
      });
      if (stops.length !== tournee.stops.length) {
        await ctx.db.patch(tournee._id, {
          stops: stops.map((stop, index) => ({ ...stop, order: index })),
        });
      }
    }

    const publicDrafts = await ctx.db.query("publicStripeCheckoutDrafts").take(500);
    for (const draft of publicDrafts) {
      if (draft.requestId === id) {
        await ctx.db.patch(draft._id, { requestId: undefined });
      }
    }

    if (request.type === "article") {
      for (const articleId of requestArticleIds(request)) {
        const article = await ctx.db.get(articleId);
        if (article?.status === "reserve") {
          await ctx.db.patch(articleId, { status: "disponible" });
          articleReservationsReleased++;
        }
      }
    }

    const storageDeleted = await deleteStorageBestEffort(ctx, [
      ...requestPhotoIds,
      ...documentStorageIds,
    ]);

    await ctx.db.delete(id);

    return {
      deleted: true,
      messagesDeleted,
      notificationsDeleted,
      documentsDeleted,
      trackingLinksDeleted,
      tourneeStopsRemoved,
      articleReservationsReleased,
      storageDeleted,
    };
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
    // Nom de l'auteur (persona sélectionné ou nom du compte).
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const request = await ctx.db.get(args.id);
    if (!request) throw new Error("Demande introuvable.");
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    if (args.site !== undefined) {
      setPatchIfChanged(patch, changed, "site", request.site, args.site);
    }
    if (args.assignedTo !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "assignedTo",
        request.assignedTo,
        args.assignedTo ?? undefined,
      );
    }
    if (args.assignedVehicle !== undefined) {
      if (args.assignedVehicle) {
        const date = request.scheduledDate ?? Date.now();
        const reason = await vehicleBusyReason(ctx, args.assignedVehicle, date, {
          excludeRequestId: args.id,
        });
        if (reason) {
          throw new Error(`Véhicule indisponible à cette date : ${reason}`);
        }
      }
      setPatchIfChanged(
        patch,
        changed,
        "assignedVehicle",
        request.assignedVehicle,
        args.assignedVehicle ?? undefined,
      );
    }
    if (args.estimatedHours !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "estimatedHours",
        request.estimatedHours,
        args.estimatedHours ?? undefined,
      );
    }
    if (args.actualHours !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "actualHours",
        request.actualHours,
        args.actualHours ?? undefined,
      );
    }
    if (args.quoteAmount !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "quoteAmount",
        request.quoteAmount,
        args.quoteAmount ?? undefined,
      );
    }
    if (args.quoteDetails !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "quoteDetails",
        request.quoteDetails,
        args.quoteDetails ?? undefined,
      );
    }
    if (args.visitNeeded !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "visitNeeded",
        request.visitNeeded,
        args.visitNeeded ?? undefined,
      );
    }
    if (args.beforePhotos !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "beforePhotos",
        request.beforePhotos,
        args.beforePhotos,
        false,
      );
    }
    if (args.afterPhotos !== undefined) {
      setPatchIfChanged(
        patch,
        changed,
        "afterPhotos",
        request.afterPhotos,
        args.afterPhotos,
        false,
      );
    }
    if (Object.keys(patch).length === 0) return;
    patch.updatedAt = Date.now();
    const fieldEdits = withFieldEdits(request.fieldEdits, changed, args.actorName);
    if (fieldEdits) patch.fieldEdits = fieldEdits;
    await ctx.db.patch(args.id, patch);
  },
});

/** Planifie (ou déplanifie) la prestation pour le calendrier. */
export const schedule = mutation({
  args: {
    id: v.id("requests"),
    scheduledDate: v.optional(v.number()),
    assignedVehicle: v.optional(v.union(v.id("vehicles"), v.null())),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, { id, scheduledDate, assignedVehicle, actorName }) => {
    await requireAnyCrmPermission(ctx, [["demandes", "update"], ["calendrier", "update"]]);
    const previous = await ctx.db.get(id);
    const patch: Record<string, unknown> = {
      scheduledDate,
      updatedAt: Date.now(),
    };
    const changed = ["scheduledDate"];
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
      changed.push("assignedVehicle");
    }
    const fieldEdits = withFieldEdits(previous?.fieldEdits, changed, actorName);
    if (fieldEdits) patch.fieldEdits = fieldEdits;
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
    // La facture vient d'être éditée et « Facture réglée » est l'étape
    // suivante : on prévient la compta qu'un règlement est à encaisser puis à
    // cocher dans le CRM.
    if (isAwaitingInvoicePayment(steps, completedSteps)) {
      await ctx.scheduler.runAfter(0, internal.emails.sendInvoicePendingPayment, {
        reference: r.reference ?? String(r._id).slice(-6),
        type: r.type,
        customerName: customerFullName(r.customer) || "Client inconnu",
        amount: r.quoteAmount,
        requestId: String(r._id),
      });
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
  args: { id: v.id("requests"), collecteType, actorName: v.optional(v.string()) },
  handler: async (ctx, { id, collecteType: ct, actorName }) => {
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
      fieldEdits: withFieldEdits(r.fieldEdits, ["collecteType"], actorName),
    });
  },
});

/**
 * Ajoute des photos (uploadées par l'équipe) à une catégorie d'objets d'une
 * collecte. Fusionne avec les photos déjà présentes pour cette catégorie et
 * s'assure que la catégorie apparaît dans `objectCategories`.
 */
export const addCollecteCategoryPhotos = mutation({
  args: {
    id: v.id("requests"),
    category: v.string(),
    photos: v.array(v.id("_storage")),
  },
  handler: async (ctx, { id, category, photos }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    if (photos.length === 0) return;
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Demande introuvable.");
    if (r.type !== "collecte") throw new Error("Type de demande invalide.");

    const collecte = r.collecte ?? {};
    const categoryPhotos = [...(collecte.categoryPhotos ?? [])];
    const existing = categoryPhotos.find((e) => e.category === category);
    if (existing) {
      existing.photos = [...existing.photos, ...photos];
    } else {
      categoryPhotos.push({ category, photos });
    }
    const objectCategories = collecte.objectCategories ?? [];
    const nextCategories = objectCategories.includes(category)
      ? objectCategories
      : [...objectCategories, category];

    await ctx.db.patch(id, {
      collecte: { ...collecte, categoryPhotos, objectCategories: nextCategories },
      updatedAt: Date.now(),
    });
  },
});

/** Retire une photo d'une catégorie d'objets d'une collecte (index dans la catégorie). */
export const removeCollecteCategoryPhoto = mutation({
  args: {
    id: v.id("requests"),
    category: v.string(),
    index: v.number(),
  },
  handler: async (ctx, { id, category, index }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Demande introuvable.");
    if (r.type !== "collecte" || !r.collecte) return;

    const categoryPhotos = (r.collecte.categoryPhotos ?? [])
      .map((entry) => {
        if (entry.category !== category) return entry;
        const photos = entry.photos.filter((_, i) => i !== index);
        return { ...entry, photos };
      })
      .filter((entry) => entry.photos.length > 0);

    await ctx.db.patch(id, {
      collecte: { ...r.collecte, categoryPhotos },
      updatedAt: Date.now(),
    });
  },
});

/** Met à jour les coordonnées du client d'une demande (onglet Client). */
export const updateCustomer = mutation({
  args: { id: v.id("requests"), customer: customerArg, actorName: v.optional(v.string()) },
  handler: async (ctx, { id, customer, actorName }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const request = await ctx.db.get(id);
    if (!request) throw new Error("Demande introuvable.");
    const nextCustomer = normalizeCustomer(customer);
    if (sameValue(normalizeCustomer(request.customer), nextCustomer)) return;
    await ctx.db.patch(id, {
      customer: nextCustomer,
      updatedAt: Date.now(),
      fieldEdits: withFieldEdits(request.fieldEdits, ["customer"], actorName),
    });
  },
});

/** Met à jour les champs renseignés par le client pour une demande d'aérogommage. */
export const updateAerogommageDetails = mutation({
  args: {
    id: v.id("requests"),
    comment: v.optional(v.string()),
    items: v.array(aerogommageItem),
    aerogommageOptions: v.optional(aerogommageOptionsArg),
    actorName: v.optional(v.string()),
  },
  handler: async (ctx, { id, comment, items, aerogommageOptions, actorName }) => {
    await requireCrmPermission(ctx, "demandes", "update");
    const request = await ctx.db.get(id);
    if (!request) throw new Error("Demande introuvable.");
    if (request.type !== "aerogommage") {
      throw new Error("Type de demande invalide.");
    }

    const nextComment = comment?.trim() || undefined;
    const nextComplete = isAerogommageComplete(request.customer, items);
    const patch: Record<string, unknown> = {};
    const changed: string[] = [];
    setPatchIfChanged(patch, changed, "comment", request.comment, nextComment);
    setPatchIfChanged(patch, changed, "aerogommage", request.aerogommage, items);
    setPatchIfChanged(
      patch,
      changed,
      "aerogommageOptions",
      request.aerogommageOptions,
      aerogommageOptions,
    );
    setPatchIfChanged(patch, changed, "complete", request.complete, nextComplete, false);
    if (Object.keys(patch).length === 0) return;
    patch.updatedAt = Date.now();
    const fieldEdits = withFieldEdits(request.fieldEdits, changed, actorName);
    if (fieldEdits) patch.fieldEdits = fieldEdits;
    await ctx.db.patch(id, patch);
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

/**
 * Demandes dont la facture est éditée et dont l'étape suivante est
 * « Facture réglée » — c.-à-d. les factures en attente de règlement.
 */
type PendingInvoice = {
  reference: string;
  type: string;
  customerName: string;
  amount?: number;
  requestId: string;
};

export const pendingInvoices = internalQuery({
  args: {},
  handler: async (ctx): Promise<PendingInvoice[]> => {
    const all = await ctx.db.query("requests").collect();
    return all
      .filter(
        (r) =>
          r.outcome === "open" &&
          isAwaitingInvoicePayment(r.processSteps ?? [], r.completedSteps ?? 0),
      )
      .map((r) => ({
        reference: r.reference ?? String(r._id).slice(-6),
        type: r.type,
        customerName:
          customerFullName(normalizeCustomer(r.customer)) || "Client inconnu",
        amount: r.quoteAmount,
        requestId: String(r._id),
      }));
  },
});

/**
 * Envoie à la compta le récapitulatif des factures en attente de règlement.
 * Déclenchable à la main (`npx convex run requests:sendPendingInvoicesDigest`)
 * pour remettre la liste à jour sur les demandes déjà en cours.
 */
export const sendPendingInvoicesDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ count: number }> => {
    const requests: PendingInvoice[] = await ctx.runQuery(
      internal.requests.pendingInvoices,
      {},
    );
    await ctx.runAction(internal.emails.sendInvoicePendingDigest, { requests });
    return { count: requests.length };
  },
});
