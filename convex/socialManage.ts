/**
 * Modification et suppression des publications déjà parties sur Facebook.
 *
 * Facebook accepte de réécrire le texte d'un post et de le supprimer, mais pas
 * d'en changer les photos : « modifier » ne porte donc que sur le message.
 * Instagram n'expose ni suppression ni réécriture de légende — ces publications
 * ne sont pas concernées.
 *
 * Un post supprimé chez Facebook doit disparaître de Mes Outils tout de suite :
 * la synchronisation ne le retirerait qu'au passage suivant, et l'agenda
 * afficherait entre-temps une publication qui n'existe plus.
 */
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";
import { removeSocialRecord } from "./socialSync";

const PAGE = "mesoutils:actualites";
const GRAPH_VERSION = "v26.0";
/** Limite d'un post Facebook, comme à la composition. */
const MAX_MESSAGE = 63206;

/**
 * Retrouve le post distant derrière une entrée du calendrier : celle-ci porte
 * soit l'identifiant d'une livraison du compositeur, soit celui d'un miroir
 * `socialFacebookPosts` (partages d'évènements et posts importés).
 */
export const source = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, PAGE, "publish");
    const deliveryId = ctx.db.normalizeId("socialDeliveries", id);
    const recordId = ctx.db.normalizeId("socialFacebookPosts", id);
    const delivery = deliveryId ? await ctx.db.get(deliveryId) : null;
    let record = recordId ? await ctx.db.get(recordId) : null;
    if (delivery) {
      const records = await ctx.db.query("socialFacebookPosts").withIndex("by_composer", q => q.eq("composerId", delivery.compositionId)).collect();
      record = records.find(p => p.pageId === delivery.targetId && (p.network ?? "facebook") === delivery.network) ?? null;
    }
    if (!delivery && !record) throw new Error("Publication introuvable.");
    const network = delivery?.network ?? record?.network ?? "facebook";
    if (network !== "facebook") throw new Error("Instagram ne permet ni de modifier ni de supprimer une publication depuis une application.");
    if (delivery && delivery.status !== "published") {
      throw new Error(delivery.status === "scheduled"
        ? "Cette publication n'est pas encore partie : utilisez « Annuler cette programmation »."
        : "Cette publication n'est pas en ligne sur Facebook.");
    }
    const postId = delivery?.postId ?? record?.postId;
    if (!postId) throw new Error("Le réseau n'a pas fourni d'identifiant de publication.");
    const pageId = delivery?.targetId ?? record!.pageId;
    const page = await ctx.db.query("socialFacebookPages").withIndex("by_pageId", q => q.eq("pageId", pageId)).unique();
    if (!page?.accessToken) throw new Error("Reconnectez la page Facebook pour gérer ses publications.");
    return {
      postId,
      accessToken: page.accessToken,
      pageName: page.name,
      recordId: record?._id ?? null,
      deliveryId: delivery?._id ?? null,
    };
  },
});

/** Appel Graph commun : renvoie le message d'erreur de Facebook tel quel. */
async function graph(postId: string, accessToken: string, method: "POST" | "DELETE", body?: URLSearchParams) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(postId)}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({})) as { success?: boolean; error?: { message?: string; code?: number } };
  if (!response.ok || result.error) {
    const detail = result.error?.message ?? `HTTP ${response.status}`;
    // Un post importé n'a pas été créé par cette application : Facebook refuse
    // alors d'y toucher, quel que soit le jeton.
    const hint = result.error?.code === 190
      ? " Le jeton de la Page n'est plus valide : reconnectez la Page."
      : result.error?.code === 200
        ? " Facebook n'autorise ces opérations que sur les publications créées depuis Mes Outils."
        : "";
    throw new Error(`Facebook a refusé l'opération : ${detail}.${hint}`);
  }
}

/**
 * Aligne le miroir local sur le texte envoyé à Facebook. Sans miroir (livraison
 * dont la synchronisation n'a pas encore ramené le post), on le crée : l'agenda
 * lit le texte du miroir dès qu'il existe.
 */
export const applyUpdate = internalMutation({
  args: { recordId: v.optional(v.id("socialFacebookPosts")), deliveryId: v.optional(v.id("socialDeliveries")), postId: v.string(), message: v.string() },
  handler: async (ctx, args) => {
    if (args.recordId) {
      await ctx.db.patch(args.recordId, { message: args.message });
      return;
    }
    if (!args.deliveryId) return;
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery) return;
    const composition = await ctx.db.get(delivery.compositionId);
    if (!composition) return;
    await ctx.db.insert("socialFacebookPosts", {
      composerId: composition._id,
      network: "facebook",
      pageId: delivery.targetId,
      pageName: delivery.targetName,
      postId: args.postId,
      message: args.message,
      withPhoto: composition.images.length > 0,
      authorClerkId: composition.authorClerkId,
      authorName: composition.authorName,
      createdAt: delivery.publishedAt ?? composition.createdAt,
    });
  },
});

/** Retire le post supprimé chez Facebook de l'agenda et de l'historique. */
export const applyDeletion = internalMutation({
  args: { recordId: v.optional(v.id("socialFacebookPosts")), deliveryId: v.optional(v.id("socialDeliveries")) },
  handler: async (ctx, args) => {
    if (args.recordId) await removeSocialRecord(ctx, args.recordId);
    // `removeSocialRecord` efface la livraison associée quand elle existe ;
    // celle qui reste (miroir absent) est retirée ici.
    if (args.deliveryId && (await ctx.db.get(args.deliveryId))) await ctx.db.delete(args.deliveryId);
  },
});

export const updatePost = action({
  args: { id: v.string(), message: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const message = args.message.trim();
    if (!message) throw new Error("Le texte ne peut pas être vide.");
    if (message.length > MAX_MESSAGE) throw new Error("Le texte dépasse la longueur autorisée par Facebook.");
    const target = await ctx.runQuery(internal.socialManage.source, { id: args.id });
    await graph(target.postId, target.accessToken, "POST", new URLSearchParams({ message }));
    await ctx.runMutation(internal.socialManage.applyUpdate, {
      recordId: target.recordId ?? undefined,
      deliveryId: target.deliveryId ?? undefined,
      postId: target.postId,
      message,
    });
    return null;
  },
});

export const deletePost = action({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const target: { postId: string; accessToken: string; recordId: Id<"socialFacebookPosts"> | null; deliveryId: Id<"socialDeliveries"> | null } =
      await ctx.runQuery(internal.socialManage.source, { id: args.id });
    await graph(target.postId, target.accessToken, "DELETE");
    await ctx.runMutation(internal.socialManage.applyDeletion, {
      recordId: target.recordId ?? undefined,
      deliveryId: target.deliveryId ?? undefined,
    });
    return null;
  },
});
