import { v } from "convex/values";
import { action, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireCrmPermission } from "./lib";

export const publicationStatus = query({
  args: { id: v.id("socialCompositions") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, "mesoutils:actualites", "read");
    const deliveries = await ctx.db.query("socialDeliveries").withIndex("by_composition", q => q.eq("compositionId", id)).collect();
    return {
      total: deliveries.length,
      published: deliveries.filter(d => d.status === "published").length,
      failed: deliveries.filter(d => d.status === "failed" || d.status === "cancelled").length,
      pending: deliveries.some(d => d.status === "scheduled" || d.status === "publishing"),
    };
  },
});

export const previewSource = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, "mesoutils:actualites", "read");
    const deliveryId = ctx.db.normalizeId("socialDeliveries", id);
    const recordId = ctx.db.normalizeId("socialFacebookPosts", id);
    const delivery = deliveryId ? await ctx.db.get(deliveryId) : null;
    let record = recordId ? await ctx.db.get(recordId) : null;
    if (delivery) {
      if (delivery.status !== "published") throw new Error("Cette publication n'est pas encore publiée.");
      const records = await ctx.db.query("socialFacebookPosts").withIndex("by_composer", q => q.eq("composerId", delivery.compositionId)).collect();
      record = records.find(p => p.pageId === delivery.targetId && (p.network ?? "facebook") === delivery.network) ?? null;
    }
    if (!delivery && (!record || (record.scheduledFor ?? 0) > Date.now())) throw new Error("Publication introuvable ou non publiée.");
    const postId = delivery?.postId ?? record?.postId;
    if (!postId) throw new Error("Le réseau n'a pas fourni d'identifiant de publication.");
    const network = delivery?.network ?? record?.network ?? "facebook";
    const pageId = delivery?.targetId ?? record!.pageId;
    const page = network === "instagram" ? (await ctx.db.query("socialFacebookPages").collect()).find(p => p.instagramId === pageId && p.active) : await ctx.db.query("socialFacebookPages").withIndex("by_pageId", q => q.eq("pageId", pageId)).unique();
    return { postId, pageId, network, accessToken: page?.accessToken };
  },
});

export const publishedPreview = action({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<{ permalink: string; embedUrl: string; network: string }> => {
    const source = await ctx.runQuery(internal.socialEnhancements.previewSource, args);
    if (source.network === "facebook") {
      const [pageId, postId] = source.postId.split("_");
      let permalink = postId ? `https://www.facebook.com/${encodeURIComponent(pageId)}/posts/${encodeURIComponent(postId)}` : `https://www.facebook.com/${encodeURIComponent(source.postId)}`;
      // Prefer Meta's canonical permalink (some Pages use pfbid URLs).
      if (source.accessToken) {
        try {
          const response = await fetch(`https://graph.facebook.com/v26.0/${encodeURIComponent(source.postId)}?fields=permalink_url`, { headers: { Authorization: `Bearer ${source.accessToken}` }, signal: AbortSignal.timeout(15000) });
          const data = await response.json() as { permalink_url?: string };
          if (response.ok && data.permalink_url) {
            const url = new URL(data.permalink_url);
            if (url.protocol === "https:" && ["www.facebook.com", "facebook.com"].includes(url.hostname)) permalink = url.href;
          }
        } catch { /* Keep the stable post URL when Meta cannot resolve it. */ }
      }
      return { network: source.network, permalink, embedUrl: `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(permalink)}&show_text=true&width=500` };
    }
    if (!source.accessToken) throw new Error("Reconnectez le compte Instagram pour afficher la publication originale.");
    const response = await fetch(`https://graph.facebook.com/v26.0/${encodeURIComponent(source.postId)}?fields=permalink`, {
      headers: { Authorization: `Bearer ${source.accessToken}` }, signal: AbortSignal.timeout(15000),
    });
    const data = await response.json() as { permalink?: string };
    if (!response.ok || !data.permalink) throw new Error("Instagram ne permet pas d'afficher cette publication pour le moment.");
    const url = new URL(data.permalink);
    if (url.protocol !== "https:" || !["www.instagram.com", "instagram.com"].includes(url.hostname) || !/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error("Lien Instagram invalide.");
    const permalink = `https://www.instagram.com${url.pathname.replace(/\/$/, "")}/`;
    return { network: source.network, permalink, embedUrl: `${permalink}embed/captioned/` };
  },
});
