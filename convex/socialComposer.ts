import { v } from "convex/values";
import { mutation, query, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireCrmPermission, requireUser, formatUserName } from "./lib";
import { sendFacebook, sendInstagram } from "./social";

const PAGE = "mesoutils:actualites";

export const create = mutation({
  args: {
    requestKey: v.string(), message: v.string(), images: v.array(v.id("_storage")),
    facebookIds: v.array(v.string()), instagramIds: v.array(v.string()),
    scheduledFor: v.optional(v.number()), publishOnMesoutils: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE, "publish");
    const identity = await requireUser(ctx);
    // A repeated browser submission must never create duplicate public posts.
    const previous = await ctx.db.query("socialCompositions").withIndex("by_requestKey", q => q.eq("requestKey", args.requestKey)).unique();
    if (previous) {
      if (previous.authorClerkId !== identity.subject) throw new Error("Identifiant de publication déjà utilisé.");
      return previous._id;
    }
    const message = args.message.trim();
    const facebookIds = [...new Set(args.facebookIds)];
    const instagramIds = [...new Set(args.instagramIds)];
    if (!facebookIds.length && !instagramIds.length) throw new Error("Sélectionnez au moins une page ou un compte.");
    if (!message && !args.images.length) throw new Error("Ajoutez un texte ou une photo.");
    if (message.length > (instagramIds.length ? 2200 : 63206)) throw new Error("Le texte dépasse la longueur autorisée pour le réseau choisi.");
    if (args.images.length > 10) throw new Error("Ajoutez au maximum 10 photos.");
    if (instagramIds.length && !args.images.length) throw new Error("Instagram nécessite au moins une photo.");
    const now = Date.now();
    if (args.scheduledFor !== undefined && (!Number.isFinite(args.scheduledFor) || args.scheduledFor < now + 60_000 || args.scheduledFor > now + 180 * 86400_000)) {
      throw new Error("Choisissez une date entre une minute et six mois à partir de maintenant.");
    }
    for (const image of args.images) {
      const file = await ctx.db.system.get(image);
      if (!file?.contentType?.startsWith("image/")) throw new Error("Une photo est introuvable ou son format est invalide.");
      if (instagramIds.length && file.contentType !== "image/jpeg") throw new Error("Pour Instagram, utilisez des photos JPEG.");
    }
    const pages = (await ctx.db.query("socialFacebookPages").collect()).filter(p => p.active);
    const targets = [
      ...facebookIds.map(id => {
        const page = pages.find(p => p.pageId === id);
        if (!page) throw new Error("Une page Facebook n'est plus disponible.");
        return { network: "facebook" as const, targetId: id, targetName: page.name };
      }),
      ...instagramIds.map(id => {
        const page = pages.find(p => p.instagramId === id);
        if (!page) throw new Error("Un compte Instagram n'est plus disponible.");
        return { network: "instagram" as const, targetId: id, targetName: `@${page.instagramUsername ?? page.name}` };
      }),
    ];
    const authorName = formatUserName(identity);
    let mesoutilsPostId;
    if (args.publishOnMesoutils) {
      await requireCrmPermission(ctx, PAGE, "create");
      mesoutilsPostId = await ctx.db.insert("posts", {
        authorClerkId: identity.subject, authorName,
        authorImageUrl: (identity as { pictureUrl?: string }).pictureUrl,
        body: message, images: args.images, createdAt: now, pinned: false,
      });
    }
    const id = await ctx.db.insert("socialCompositions", {
      requestKey: args.requestKey, message, images: args.images,
      authorClerkId: identity.subject, authorName, scheduledFor: args.scheduledFor,
      mesoutilsPostId, createdAt: now,
    });
    for (const target of targets) {
      const deliveryId = await ctx.db.insert("socialDeliveries", {
        compositionId: id, ...target, status: "scheduled", scheduledFor: args.scheduledFor ?? now,
      });
      const schedulerId = await ctx.scheduler.runAt(args.scheduledFor ?? now, internal.socialComposer.deliver, { id: deliveryId });
      await ctx.db.patch(deliveryId, { schedulerId });
    }
    return id;
  },
});

export const list = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, { start, end }) => {
    await requireCrmPermission(ctx, PAGE, "read");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 370 * 86400_000) throw new Error("Période invalide.");
    const deliveries = await ctx.db.query("socialDeliveries").withIndex("by_date", q => q.gte("scheduledFor", start).lt("scheduledFor", end)).collect();
    const compositions = new Map(await Promise.all([...new Set(deliveries.map(d => d.compositionId))].map(async id => [id, await ctx.db.get(id)] as const)));
    const [publishedRecords, scheduledRecords, compositionRecords] = await Promise.all([
      ctx.db.query("socialFacebookPosts").withIndex("by_createdAt", q => q.gte("createdAt", start).lt("createdAt", end)).collect(),
      ctx.db.query("socialFacebookPosts").withIndex("by_scheduledFor", q => q.gte("scheduledFor", start).lt("scheduledFor", end)).collect(),
      Promise.all([...compositions.keys()].map(id => ctx.db.query("socialFacebookPosts").withIndex("by_composer", q => q.eq("composerId", id)).collect())),
    ]);
    const records = [...new Map([...publishedRecords, ...scheduledRecords, ...compositionRecords.flat()].map(p => [p._id, p])).values()];
    const remoteByTarget = new Map(records.filter(p => p.composerId).map(p => [`${p.composerId}:${p.network ?? "facebook"}:${p.pageId}`, p]));
    const current = deliveries.map(d => {
      const post = compositions.get(d.compositionId);
      const remote = remoteByTarget.get(`${d.compositionId}:${d.network}:${d.targetId}`);
      return { id: d._id as string, deliveryId: d._id, network: d.network, targetName: d.targetName, date: d.scheduledFor, status: d.status as string, message: remote?.message ?? post?.message ?? "", authorName: post?.authorName ?? "", error: d.error, mesoutils: Boolean(post?.mesoutilsPostId), postId: d.postId ?? remote?.postId };
    });
    // Include the existing event/post shares, without duplicating composer deliveries.
    const recordedIds = new Set(deliveries.map(d => d.postId).filter(Boolean));
    const legacy = records.filter(p => {
      const date = p.scheduledFor ?? p.createdAt;
      return date >= start && date < end && !p.composerId && !recordedIds.has(p.postId);
    }).map(p => ({ id: p._id as string, deliveryId: undefined, network: p.network ?? "facebook", targetName: p.pageName, date: p.scheduledFor ?? p.createdAt, status: p.scheduledFor && p.scheduledFor > Date.now() ? "scheduled" : "published", message: p.message, authorName: p.authorName, error: undefined, mesoutils: Boolean(p.sourcePostId), postId: p.postId }));
    return [...current, ...legacy].sort((a, b) => b.date - a.date);
  },
});

export const cancel = mutation({
  args: { id: v.id("socialDeliveries") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, PAGE, "publish");
    const delivery = await ctx.db.get(id);
    if (!delivery || delivery.status !== "scheduled") throw new Error("Cette publication ne peut plus être annulée.");
    if (delivery.schedulerId) await ctx.scheduler.cancel(delivery.schedulerId);
    await ctx.db.patch(id, { status: "cancelled" });
  },
});

export const claim = internalMutation({
  args: { id: v.id("socialDeliveries") },
  handler: async (ctx, { id }) => {
    const delivery = await ctx.db.get(id);
    if (!delivery || delivery.status !== "scheduled") return null;
    const composition = await ctx.db.get(delivery.compositionId);
    if (!composition) return null;
    await ctx.db.patch(id, { status: "publishing" });
    return { delivery, composition };
  },
});

export const finish = internalMutation({
  args: { id: v.id("socialDeliveries"), error: v.optional(v.string()), postId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.error ? "failed" : "published", error: args.error, postId: args.postId, publishedAt: args.error ? undefined : Date.now() });
  },
});

export const deliver = internalAction({
  args: { id: v.id("socialDeliveries") },
  handler: async (ctx, { id }) => {
    const work = await ctx.runMutation(internal.socialComposer.claim, { id });
    if (!work) return;
    const { delivery, composition } = work;
    try {
      const author = { clerkId: composition.authorClerkId, name: composition.authorName };
      const source = { composerId: composition._id, message: composition.message, photoStorageIds: composition.images };
      let postId: string | undefined;
      if (delivery.network === "facebook") {
        const result = await sendFacebook(ctx, { ...source, pageId: delivery.targetId }, author);
        postId = result.postId;
      } else {
        const result = await sendInstagram(ctx, { ...source, instagramIds: [delivery.targetId] }, author);
        if (!result.published.length) throw new Error("Le compte Instagram n'est plus disponible.");
      }
      await ctx.runMutation(internal.socialComposer.finish, { id, postId });
    } catch (error) {
      await ctx.runMutation(internal.socialComposer.finish, { id, error: error instanceof Error ? error.message : "Échec de publication." });
    }
  },
});
