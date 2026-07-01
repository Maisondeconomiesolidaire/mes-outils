import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { normalizeCustomer, requireUser, titleCaseName } from "./lib";
import { STEP } from "./processes";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Statut client dérivé de l'avancement réel de la demande (et non du champ
 * `stage` figé). Reste synchronisé avec le CRM : à chaque étape cochée /
 * outcome modifié côté staff, le client voit le statut bouger.
 *
 * Flux : Demande reçue → Validation → Planifiée → Terminée (ou Annulée).
 */
export const CLIENT_STATUS_FLOW = [
  { key: "nouveau", label: "Demande reçue" },
  { key: "validation", label: "Validation" },
  { key: "planifie", label: "Planifiée" },
  { key: "termine", label: "Terminée" },
] as const;

export function deriveClientStatus(request: Doc<"requests">) {
  if (request.outcome === "perdue") {
    return { key: "annulee", label: "Annulée", index: -1, cancelled: true };
  }
  if (request.outcome === "gagnee") {
    return { key: "termine", label: "Terminée", index: 3, cancelled: false };
  }
  const done = (request.processSteps ?? []).slice(0, request.completedSteps ?? 0);
  if (done.includes(STEP.prestaPlanifiee)) {
    return { key: "planifie", label: "Planifiée", index: 2, cancelled: false };
  }
  if (done.includes(STEP.devisEdite) || done.includes(STEP.devisSigne)) {
    return { key: "validation", label: "Validation", index: 1, cancelled: false };
  }
  return { key: "nouveau", label: "Demande reçue", index: 0, cancelled: false };
}

async function getProfileByClerkId(ctx: QueryCtx | MutationCtx, clerkId: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", clerkId))
    .unique();
}

/**
 * Appelée à la connexion : crée le profil s'il n'existe pas et rattache
 * automatiquement les demandes passées dont l'email correspond.
 */
export const syncProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const clerkId = identity.subject;
    const email = (identity.email ?? "").toLowerCase();

    let profile = await getProfileByClerkId(ctx, clerkId);
    const now = Date.now();

    if (!profile) {
      const profileId = await ctx.db.insert("users", {
        clerkId,
        email,
        firstName: identity.givenName ? titleCaseName(identity.givenName) : undefined,
        lastName: identity.familyName ? titleCaseName(identity.familyName) : undefined,
        createdAt: now,
        updatedAt: now,
      });
      profile = await ctx.db.get(profileId);
    } else if (email && profile.email !== email) {
      await ctx.db.patch(profile._id, { email, updatedAt: now });
    }

    // Rattacher les demandes existantes créées sans compte (par email).
    if (email) {
      const candidates = await ctx.db.query("requests").collect();
      await Promise.all(
        candidates
          .filter((r) => !r.userId && r.customer.email?.toLowerCase() === email)
          .map((r) => ctx.db.patch(r._id, { userId: clerkId })),
      );
    }

    return profile;
  },
});

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const profile = await getProfileByClerkId(ctx, identity.subject);
    if (!profile) return null;
    return {
      ...profile,
      firstName: profile.firstName ? titleCaseName(profile.firstName) : profile.firstName,
      lastName: profile.lastName ? titleCaseName(profile.lastName) : profile.lastName,
    };
  },
});

export const updateMyProfile = mutation({
  args: {
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const patch = {
      ...args,
      ...(args.firstName !== undefined ? { firstName: titleCaseName(args.firstName) } : {}),
      ...(args.lastName !== undefined ? { lastName: titleCaseName(args.lastName) } : {}),
      updatedAt: Date.now(),
    };
    const profile = await getProfileByClerkId(ctx, identity.subject);
    if (profile) {
      await ctx.db.patch(profile._id, patch);
      return;
    }
    // Le profil n'existe pas encore (syncProfile pas encore passé) : on le crée
    // pour ne jamais perdre les coordonnées saisies par le client.
    await ctx.db.insert("users", {
      clerkId: identity.subject,
      email: (identity.email ?? "").toLowerCase(),
      createdAt: Date.now(),
      ...patch,
    });
  },
});

const PROGRESS_LABELS: Record<string, string> = {
  nouveau: "Demande reçue",
  validation: "En cours de validation",
  planifie: "Planifiée",
};

export const listMyRequests = query({
  args: {
    type: v.optional(
      v.union(
        v.literal("aerogommage"),
        v.literal("collecte"),
        v.literal("article"),
        v.literal("velo"),
      ),
    ),
  },
  handler: async (ctx, { type }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const requests = await ctx.db
      .query("requests")
      .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();

    const filtered = type ? requests.filter((r) => r.type === type) : requests;

    return await Promise.all(
      filtered.map(async (r) => {
        const messages = await ctx.db
          .query("messages")
          .withIndex("by_requestId", (q) => q.eq("requestId", r._id))
          .collect();
        const unread = messages.filter(
          (m) => m.senderRole === "staff" && !m.readByClientAt,
        ).length;

        // Vignette : photo de couverture de l'article pour les demandes boutique.
        let imageUrl: string | null = null;
        if (r.type === "article") {
          const articleId = r.article?.articleId ?? r.articles?.[0]?.articleId;
          if (articleId) {
            const article = await ctx.db.get(articleId);
            const cover = article?.images?.[0];
            if (cover) imageUrl = await ctx.storage.getUrl(cover);
          }
        }

        return {
          _id: r._id,
          type: r.type,
          imageUrl,
          reference: r.reference ?? null,
          stage: r.stage,
          outcome: r.outcome,
          status: deriveClientStatus(r),
          stageLabel: PROGRESS_LABELS[r.stage] ?? r.stage,
          complete: r.complete,
          processSteps: r.processSteps,
          completedSteps: r.completedSteps,
          scheduledDate: r.scheduledDate ?? null,
          quoteAmount: r.quoteAmount ?? null,
          collecteType: r.collecteType ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          unreadMessages: unread,
          messageCount: messages.length,
        };
      }),
    );
  },
});

async function findTrackingTokenForRequest(
  ctx: QueryCtx,
  requestId: Id<"requests">,
) {
  const link = await ctx.db
    .query("tourneeTrackingLinks")
    .withIndex("by_requestId", (q) => q.eq("requestId", requestId))
    .first();
  if (!link) return null;
  const tournee = await ctx.db.get(link.tourneeId);
  return {
    shareToken: link.shareToken,
    tourneeStatus: tournee?.status ?? null,
    tourneeDate: tournee?.date ?? null,
  };
}

export const getMyRequest = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const request = await ctx.db.get(requestId);
    if (!request || request.userId !== identity.subject) return null;

    const tracking =
      request.type === "collecte" ? await findTrackingTokenForRequest(ctx, requestId) : null;

    // Articles réservés (boutique) avec leur photo de couverture, pour le récap.
    let articles: Array<{ title: string; imageUrl: string | null }> = [];
    if (request.type === "article") {
      const list = request.articles ?? (request.article ? [request.article] : []);
      articles = await Promise.all(
        list.map(async (a) => {
          const art = await ctx.db.get(a.articleId);
          const cover = art?.images?.[0];
          return {
            title: a.articleTitle,
            imageUrl: cover ? await ctx.storage.getUrl(cover) : null,
          };
        }),
      );
    }

    const aerogommage = await Promise.all(
      (request.aerogommage ?? []).map(async (item) => ({
        objectType: item.objectType ?? null,
        label: item.label ?? null,
        quantity: item.quantity ?? null,
        photoUrls: (
          await Promise.all((item.photos ?? []).map((photo) => ctx.storage.getUrl(photo)))
        ).filter((url): url is string => url !== null),
      })),
    );

    const collecteCategoryPhotos = await Promise.all(
      (request.collecte?.categoryPhotos ?? []).map(async (entry) => ({
        category: entry.category,
        urls: (
          await Promise.all(entry.photos.map((photo) => ctx.storage.getUrl(photo)))
        ).filter((url): url is string => url !== null),
      })),
    );

    return {
      articles,
      aerogommage,
      collecte: request.collecte
        ? {
            objectCategories: request.collecte.objectCategories ?? [],
            categoryPhotos: collecteCategoryPhotos,
          }
        : null,
      _id: request._id,
      type: request.type,
      reference: request.reference ?? null,
      stage: request.stage,
      stageLabel: PROGRESS_LABELS[request.stage] ?? request.stage,
      outcome: request.outcome,
      status: deriveClientStatus(request),
      complete: request.complete,
      processSteps: request.processSteps,
      completedSteps: request.completedSteps,
      scheduledDate: request.scheduledDate ?? null,
      quoteAmount: request.quoteAmount ?? null,
      quoteDetails: request.quoteDetails ?? null,
      collecteType: request.collecteType ?? null,
      comment: request.comment ?? null,
      customer: normalizeCustomer(request.customer),
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      tracking,
    };
  },
});

async function requireOwnedRequest(
  ctx: MutationCtx,
  requestId: Id<"requests">,
) {
  const identity = await requireUser(ctx);
  const request = await ctx.db.get(requestId);
  if (!request || request.userId !== identity.subject) {
    throw new Error("Demande introuvable.");
  }
  return request;
}

export const addMyAerogommageItemPhotos = mutation({
  args: {
    requestId: v.id("requests"),
    itemIndex: v.number(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, { requestId, itemIndex, storageIds }) => {
    const request = await requireOwnedRequest(ctx, requestId);
    if (request.type !== "aerogommage") {
      throw new Error("Cette demande n'est pas une demande d'aérogommage.");
    }
    const items = [...(request.aerogommage ?? [])];
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= items.length) {
      throw new Error("Objet introuvable.");
    }
    const item = items[itemIndex];
    items[itemIndex] = {
      ...item,
      photos: [...(item.photos ?? []), ...storageIds],
    };
    await ctx.db.patch(requestId, { aerogommage: items, updatedAt: Date.now() });
  },
});

export const addMyCollecteCategoryPhotos = mutation({
  args: {
    requestId: v.id("requests"),
    category: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, { requestId, category, storageIds }) => {
    const request = await requireOwnedRequest(ctx, requestId);
    if (request.type !== "collecte") {
      throw new Error("Cette demande n'est pas une demande de collecte.");
    }
    const details = request.collecte ?? {};
    const categoryPhotos = [...(details.categoryPhotos ?? [])];
    const existingIndex = categoryPhotos.findIndex((entry) => entry.category === category);
    if (existingIndex >= 0) {
      const existing = categoryPhotos[existingIndex];
      categoryPhotos[existingIndex] = {
        ...existing,
        photos: [...existing.photos, ...storageIds],
      };
    } else {
      categoryPhotos.push({ category, photos: storageIds });
    }
    await ctx.db.patch(requestId, {
      collecte: { ...details, categoryPhotos },
      updatedAt: Date.now(),
    });
  },
});
