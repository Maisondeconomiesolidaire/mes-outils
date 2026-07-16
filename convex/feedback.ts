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

    // Retours d'un ancien clerkId : rattrapés par email. Sans email (rare :
    // compte Clerk sans adresse), on s'en tient au clerkId courant — mais on
    // enrichit quand même, sinon la page reçoit des objets sans compteurs.
    const seen = new Set(mine.map((item) => item._id));
    const byEmail =
      email === ""
        ? []
        : (
            await ctx.db
              .query("feedback")
              .withIndex("by_createdAt")
              .order("desc")
              .collect()
          ).filter((item) => item.authorEmail === email && !seen.has(item._id));

    const items = [...mine, ...byEmail].sort((a, b) => b.createdAt - a.createdAt);

    // Compteurs de conversation : l'utilisateur doit voir depuis la liste
    // qu'on lui a répondu, sans ouvrir chaque fiche.
    const ids = new Set(items.map((item) => String(item._id)));
    const comments = (await ctx.db.query("feedbackComments").collect()).filter((comment) =>
      ids.has(String(comment.feedbackId)),
    );
    const stats = new Map<string, { count: number; teamReplies: number }>();
    for (const comment of comments) {
      const key = String(comment.feedbackId);
      const current = stats.get(key) ?? { count: 0, teamReplies: 0 };
      current.count += 1;
      if (comment.fromTeam) current.teamReplies += 1;
      stats.set(key, current);
    }

    return items.map((item) => {
      const stat = stats.get(String(item._id)) ?? { count: 0, teamReplies: 0 };
      return { ...item, commentCount: stat.count, teamReplyCount: stat.teamReplies };
    });
  },
});

/** Vrai si `clerkId`/`email` est l'auteur du retour (repli email : cf. listMine). */
function isAuthor(
  item: { authorClerkId: string; authorEmail: string },
  clerkId: string,
  email: string,
) {
  return item.authorClerkId === clerkId || (email !== "" && item.authorEmail === email);
}

/**
 * Un retour et sa conversation. Accessible à **l'auteur** (sa fiche) et à
 * l'équipe produit (le kanban) — personne d'autre : les retours peuvent
 * contenir des captures de situations internes.
 */
export const thread = query({
  args: { id: v.id("feedback") },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const item = await ctx.db.get(args.id);
    if (!item) return null;

    const email = normalizeEmail(identity.email);
    const admin = isFeedbackAdminEmail(identity.email);
    if (!admin && !isAuthor(item, identity.subject, email)) {
      throw new Error("Ce retour ne vous appartient pas.");
    }

    const comments = await ctx.db
      .query("feedbackComments")
      .withIndex("by_feedback_and_createdAt", (q) => q.eq("feedbackId", args.id))
      .order("asc")
      .collect();

    return { item, comments, canModerate: admin };
  },
});

/**
 * Ajout d'un message. Ouvert à l'auteur **et** à l'équipe produit : c'est ce
 * qui fait la conversation. `fromTeam` fige le rôle au moment de l'écriture,
 * pour que l'affichage reste juste même si les droits changent plus tard.
 */
export const addComment = mutation({
  args: { id: v.id("feedback"), body: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("Retour introuvable.");

    const email = normalizeEmail(identity.email);
    const admin = isFeedbackAdminEmail(identity.email);
    if (!admin && !isAuthor(item, identity.subject, email)) {
      throw new Error("Ce retour ne vous appartient pas.");
    }

    const body = args.body.trim();
    if (body === "") throw new Error("Le message est vide.");

    const now = Date.now();
    const commentId = await ctx.db.insert("feedbackComments", {
      feedbackId: args.id,
      body,
      authorClerkId: identity.subject,
      authorEmail: email,
      authorName: identity.name ?? undefined,
      authorImageUrl: identity.pictureUrl ?? undefined,
      fromTeam: admin,
      createdAt: now,
    });
    await ctx.db.patch(args.id, { lastCommentAt: now, updatedAt: now });
    return commentId;
  },
});

/** Suppression de son propre message (ou de n'importe lequel pour l'équipe). */
export const removeComment = mutation({
  args: { commentId: v.id("feedbackComments") },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return;
    const admin = isFeedbackAdminEmail(identity.email);
    if (!admin && comment.authorClerkId !== identity.subject) {
      throw new Error("Ce message n'est pas le vôtre.");
    }
    await ctx.db.delete(args.commentId);
  },
});

/** Kanban complet — réservé à l'équipe produit. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireFeedbackAdmin(ctx);
    const items = await ctx.db
      .query("feedback")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();
    const comments = await ctx.db.query("feedbackComments").collect();
    const countById = new Map<string, number>();
    for (const comment of comments) {
      countById.set(comment.feedbackId, (countById.get(comment.feedbackId) ?? 0) + 1);
    }
    return items.map((item) => ({
      ...item,
      commentCount: countById.get(item._id) ?? 0,
    }));
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

/**
 * Suppression d'un retour — réservé à l'équipe produit. La conversation part
 * avec : sans ça les messages resteraient en base, rattachés à un retour
 * inexistant.
 */
export const remove = mutation({
  args: { id: v.id("feedback") },
  handler: async (ctx, args) => {
    await requireFeedbackAdmin(ctx);
    const comments = await ctx.db
      .query("feedbackComments")
      .withIndex("by_feedback_and_createdAt", (q) => q.eq("feedbackId", args.id))
      .collect();
    for (const comment of comments) {
      await ctx.db.delete(comment._id);
    }
    await ctx.db.delete(args.id);
  },
});
