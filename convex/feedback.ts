import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { feedbackApp, feedbackStatus, feedbackType } from "./schema";
import { normalizeEmail, requireUser } from "./lib";

/**
 * App « Feedback » (feedback.groupemes.fr) — retours des utilisateurs sur les
 * apps de l'écosystème.
 *
 * Deux niveaux d'accès seulement, volontairement **hors** `crmPermissions` :
 *
 * - tout utilisateur Clerk connecté peut déposer un retour et relire *les
 *   siens* (`submit`, `listMine`) ;
 * - le kanban et l'écriture du statut sont réservés aux adresses de
 *   `FEEDBACK_ADMIN_EMAILS`.
 *
 * On n'utilise pas `crmPermissions` ici : le but est justement que **tous** les
 * utilisateurs des 6 apps puissent remonter un problème, y compris ceux qui
 * n'ont aucun droit CRM (clients boutique, comptes sans grants). Un `pageKey`
 * n'apporterait rien et il faudrait l'attribuer à tout le monde à la main.
 * Même approche que `PERMANENT_DELETE_EMAIL` dans `equipements.ts`.
 */
const FEEDBACK_ADMIN_EMAILS = [
  "lahmerselim@gmail.com",
  "s.lahmer@eco-solidaire.fr",
];

function isFeedbackAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized !== "" && FEEDBACK_ADMIN_EMAILS.includes(normalized);
}

/** Identité + garde-fou kanban. Lève si l'utilisateur n'est pas autorisé. */
async function requireFeedbackAdmin(ctx: QueryCtx | MutationCtx) {
  const identity = await requireUser(ctx);
  if (!isFeedbackAdminEmail(identity.email)) {
    throw new Error("Accès réservé à l'équipe produit.");
  }
  return identity;
}

/**
 * Le frontend s'en sert pour n'afficher le kanban qu'aux ayants droit. La
 * sécurité réelle reste côté serveur : `list` et `setStatus` re-vérifient.
 */
export const amIFeedbackAdmin = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    return isFeedbackAdminEmail(identity.email);
  },
});

/** Dépôt d'un retour — ouvert à tout utilisateur connecté. */
export const submit = mutation({
  args: {
    app: feedbackApp,
    type: feedbackType,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const description = args.description.trim();
    if (description.length === 0) {
      throw new Error("La description est obligatoire.");
    }

    const email = normalizeEmail(identity.email);
    if (email === "") {
      throw new Error("Compte sans adresse email : retour impossible.");
    }

    const now = Date.now();
    return await ctx.db.insert("feedback", {
      app: args.app,
      type: args.type,
      description,
      status: "nouveau",
      authorClerkId: identity.subject,
      authorEmail: email,
      authorName: identity.name ?? undefined,
      authorImageUrl: identity.pictureUrl ?? undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Les retours de l'utilisateur connecté (sa page « Mes retours »).
 *
 * On lit par `authorClerkId`, mais on complète avec les retours déposés sous un
 * **ancien** `clerkId` : la table `users` conserve `previousClerkIds` après la
 * migration Clerk dev → prod, et un utilisateur ne doit pas « perdre » ses
 * retours. Repli par email, qui lui ne change pas.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const email = normalizeEmail(identity.email);

    const mine = await ctx.db
      .query("feedback")
      .withIndex("by_author_and_createdAt", (q) =>
        q.eq("authorClerkId", identity.subject),
      )
      .order("desc")
      .collect();

    if (email === "") return mine;

    // Retours d'un ancien clerkId : rattrapés par email.
    const seen = new Set(mine.map((item) => item._id));
    const byEmail = (
      await ctx.db
        .query("feedback")
        .withIndex("by_createdAt")
        .order("desc")
        .collect()
    ).filter((item) => item.authorEmail === email && !seen.has(item._id));

    return [...mine, ...byEmail].sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Kanban complet — réservé à l'équipe produit. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireFeedbackAdmin(ctx);
    return await ctx.db
      .query("feedback")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();
  },
});

/** Déplacement d'une carte dans le kanban — réservé à l'équipe produit. */
export const setStatus = mutation({
  args: {
    id: v.id("feedback"),
    status: feedbackStatus,
  },
  handler: async (ctx, args) => {
    await requireFeedbackAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Retour introuvable.");
    await ctx.db.patch(args.id, { status: args.status, updatedAt: Date.now() });
  },
});

/** Réponse de l'équipe à un retour — réservé à l'équipe produit. */
export const setAdminNote = mutation({
  args: {
    id: v.id("feedback"),
    adminNote: v.string(),
  },
  handler: async (ctx, args) => {
    await requireFeedbackAdmin(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Retour introuvable.");
    const note = args.adminNote.trim();
    await ctx.db.patch(args.id, {
      adminNote: note === "" ? undefined : note,
      updatedAt: Date.now(),
    });
  },
});

/** Suppression d'un retour — réservé à l'équipe produit. */
export const remove = mutation({
  args: { id: v.id("feedback") },
  handler: async (ctx, args) => {
    await requireFeedbackAdmin(ctx);
    await ctx.db.delete(args.id);
  },
});
