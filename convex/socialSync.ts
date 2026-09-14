import { v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireCrmPermission } from "./lib";
import { deletionDecision, fetchSocialSnapshot, type RemotePost } from "./lib/socialSyncSnapshot";

const networkValidator = v.union(v.literal("facebook"), v.literal("instagram"));

/** Delete only the remote mirror; the independently chosen internal post stays intact. */
export async function removeSocialRecord(ctx: MutationCtx, id: Id<"socialFacebookPosts">) {
  const record = await ctx.db.get(id);
  if (!record) return;
  if (record.composerId) {
    const deliveries = await ctx.db.query("socialDeliveries").withIndex("by_composition", q => q.eq("compositionId", record.composerId!)).collect();
    for (const delivery of deliveries) {
      if (delivery.status === "published" && delivery.targetId === record.pageId && delivery.network === (record.network ?? "facebook") && (!delivery.postId || delivery.postId === record.postId)) await ctx.db.delete(delivery._id);
    }
  }
  await ctx.db.delete(id);
}

/**
 * Intervalle minimal entre deux synchronisations automatiques.
 *
 * Un passage complet dure près d'une minute de temps d'exécution Convex et
 * plusieurs dizaines d'appels Graph. Lancé à chaque ouverture de la page par
 * chaque utilisateur, il coûterait bien plus qu'il ne rapporte : les réseaux ne
 * changent pas d'une minute à l'autre. Le bouton « Actualiser » reste, lui,
 * toujours honoré.
 */
const AUTO_MIN_INTERVAL_MS = 15 * 60 * 1000;

export const reserve = internalMutation({
  args: { minIntervalMs: v.optional(v.number()) },
  handler: async (ctx, { minIntervalMs }) => {
    const state = await ctx.db.query("socialSyncState").withIndex("by_key", q => q.eq("key", "global")).unique();
    const now = Date.now();
    if (state && (state.leaseUntil > now)) return null;
    if (minIntervalMs !== undefined && state?.finishedAt !== undefined && now - state.finishedAt < minIntervalMs) return null;
    const data = { key: "global", startedAt: now, leaseUntil: now + 300_000 };
    if (state) { await ctx.db.patch(state._id, data); return now; }
    await ctx.db.insert("socialSyncState", data);
    return now;
  },
});

export const targets = internalQuery({
  args: {},
  handler: async ctx => {
    const pages = (await ctx.db.query("socialFacebookPages").collect()).filter(p => p.active);
    const result = pages.flatMap(p => [
      { network: "facebook" as const, id: p.pageId, name: p.name, token: p.accessToken, pageRecordId: p._id, profileCheckedAt: p.profileCheckedAt },
      ...(p.instagramId ? [{ network: "instagram" as const, id: p.instagramId, name: `@${p.instagramUsername ?? p.name}`, token: p.accessToken, pageRecordId: p._id, profileCheckedAt: p.instagramProfileCheckedAt }] : []),
    ]);
    return [...new Map(result.map(t => [`${t.network}:${t.id}`, t])).values()];
  },
});

export const applySnapshot = internalMutation({
  args: { network: networkValidator, targetId: v.string(), targetName: v.string(), startedAt: v.number(), complete: v.boolean(), posts: v.array(v.object({ id: v.string(), message: v.optional(v.string()), createdAt: v.optional(v.number()), scheduledFor: v.optional(v.number()), permalink: v.optional(v.string()), withPhoto: v.optional(v.boolean()) })) },
  handler: async (ctx, args) => {
    const state = await ctx.db.query("socialSyncState").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (state?.startedAt !== args.startedAt) return { imported: 0, removed: 0 };
    const local = (await ctx.db.query("socialFacebookPosts").withIndex("by_pageId", q => q.eq("pageId", args.targetId)).collect()).filter(p => (p.network ?? "facebook") === args.network);
    const byId = new Map(local.map(p => [p.postId, p]));
    const deliveries = (await ctx.db.query("socialDeliveries").withIndex("by_target", q => q.eq("targetId", args.targetId)).collect()).filter(d => d.network === args.network && d.status === "published");
    // Repair rows left orphaned by the old Facebook-only cleaner.
    for (const delivery of deliveries) {
      if (!delivery.postId || byId.has(delivery.postId)) continue;
      const composition = await ctx.db.get(delivery.compositionId);
      if (!composition) continue;
      const id = await ctx.db.insert("socialFacebookPosts", { composerId: composition._id, network: args.network, pageId: args.targetId, pageName: args.targetName, postId: delivery.postId, message: composition.message, withPhoto: composition.images.length > 0, authorClerkId: composition.authorClerkId, authorName: composition.authorName, createdAt: delivery.publishedAt ?? composition.createdAt });
      const record = (await ctx.db.get(id))!;
      local.push(record); byId.set(record.postId, record);
    }
    let imported = 0, removed = 0;
    for (const post of args.posts) {
      const existing = byId.get(post.id);
      if (existing) {
        const patch = { createdAt: post.createdAt ?? existing.createdAt, message: post.message ?? existing.message, scheduledFor: post.scheduledFor, remotePermalink: post.permalink ?? existing.remotePermalink, withPhoto: post.withPhoto ?? existing.withPhoto };
        if (Object.entries(patch).some(([key, value]) => existing[key as keyof typeof existing] !== value)) await ctx.db.patch(existing._id, patch);
      } else if (post.createdAt !== undefined) {
        await ctx.db.insert("socialFacebookPosts", { network: args.network, pageId: args.targetId, pageName: args.targetName, postId: post.id, message: post.message ?? "", createdAt: post.createdAt, scheduledFor: post.scheduledFor, remotePermalink: post.permalink, withPhoto: post.withPhoto ?? false, importedFromNetwork: true, authorClerkId: "network", authorName: args.targetName });
        imported++;
      }
    }
    const seen = new Set(args.posts.map(p => p.id));
    for (const post of local) {
      if (seen.has(post.postId)) continue;
      // Wait for a local send to finish before evaluating its mirror.
      if (post.composerId) {
        const sending = await ctx.db.query("socialDeliveries").withIndex("by_composition", q => q.eq("compositionId", post.composerId!)).collect();
        if (sending.some(d => d.targetId === args.targetId && d.network === args.network && d.status === "publishing")) continue;
      }
      const decision = deletionDecision(post, args.startedAt, args.complete);
      if (decision === "remove") { await removeSocialRecord(ctx, post._id); removed++; }
    }
    return { imported, removed };
  },
});

export const finish = internalMutation({
  args: { startedAt: v.number(), errors: v.array(v.string()), imported: v.number(), removed: v.number() },
  handler: async (ctx, args) => {
    const state = await ctx.db.query("socialSyncState").withIndex("by_key", q => q.eq("key", "global")).unique();
    if (state?.startedAt !== args.startedAt) return;
    await ctx.db.patch(state._id, { leaseUntil: 0, finishedAt: Date.now(), errors: args.errors, imported: args.imported, removed: args.removed, lastSuccessAt: args.errors.length ? state.lastSuccessAt : Date.now() });
  },
});

export const run = internalAction({
  // `auto` : passage déclenché par l'ouverture de la page, donc espacé.
  args: { auto: v.optional(v.boolean()) },
  handler: async (ctx, { auto }): Promise<{ checked: number; forgotten: number; imported: number }> => {
    const startedAt: number | null = await ctx.runMutation(internal.socialSync.reserve, auto ? { minIntervalMs: AUTO_MIN_INTERVAL_MS } : {});
    if (startedAt === null) return { checked: 0, forgotten: 0, imported: 0 };
    const errors: string[] = [];
    let imported = 0, forgotten = 0, checked = 0;
    try {
      const accounts = await ctx.runQuery(internal.socialSync.targets, {});
      for (const target of accounts) {
        if (Date.now() - startedAt > 240_000) { errors.push("La synchronisation reprendra au prochain passage."); break; }
        try {
          const base = `https://graph.facebook.com/v26.0/${encodeURIComponent(target.id)}`;
          if (!target.profileCheckedAt || Date.now() - target.profileCheckedAt > 86400_000) {
            try {
              const url = target.network === "facebook" ? `${base}/picture?type=large&redirect=false` : `${base}?fields=profile_picture_url`;
              const response = await fetch(url, { headers: { Authorization: `Bearer ${target.token}` }, signal: AbortSignal.timeout(15000) });
              const data = await response.json() as { data?: { url?: string }; profile_picture_url?: string };
              const imageUrl = target.network === "facebook" ? data.data?.url : data.profile_picture_url;
              if (response.ok && imageUrl) await ctx.runMutation(internal.socialSync.saveProfile, { pageId: target.pageRecordId, network: target.network, imageUrl });
            } catch { /* A missing avatar must not block post synchronization. */ }
          }
          let posts: RemotePost[], complete: boolean;
          if (target.network === "facebook") {
            const [published, scheduled] = await Promise.all([
              fetchSocialSnapshot(`${base}/published_posts?fields=id,message,created_time,permalink_url,full_picture&limit=100`, target.token, "facebook"),
              fetchSocialSnapshot(`${base}/scheduled_posts?fields=id,message,created_time,scheduled_publish_time,permalink_url,full_picture&limit=100`, target.token, "facebook", true),
            ]);
            posts = [...new Map([...published.posts, ...scheduled.posts].map(p => [p.id, p])).values()];
            complete = published.complete && scheduled.complete;
          } else {
            const snapshot = await fetchSocialSnapshot(`${base}/media?fields=id,caption,timestamp,permalink&limit=100`, target.token, "instagram");
            posts = snapshot.posts; complete = snapshot.complete;
          }
          const result = await ctx.runMutation(internal.socialSync.applySnapshot, { network: target.network, targetId: target.id, targetName: target.name, startedAt, posts, complete });
          imported += result.imported; forgotten += result.removed; checked += posts.length;
          if (!complete) errors.push(`${target.name} : historique partiel, aucune suppression appliquée.`);
        } catch {
          // Never log tokens or Graph paging URLs, including in exception text.
          errors.push(`${target.name} (${target.network}) : lecture indisponible, publications conservées.`);
        }
      }
    } catch { errors.push("Synchronisation indisponible. Les publications sont conservées."); }
    await ctx.runMutation(internal.socialSync.finish, { startedAt, errors, imported, removed: forgotten });
    return { checked, forgotten, imported };
  },
});

export const refresh = action({
  args: { auto: v.optional(v.boolean()) },
  handler: async (ctx, { auto }): Promise<{ checked: number; forgotten: number; imported: number }> => {
    await ctx.runQuery(internal.social.assertCanRead, {});
    return await ctx.runAction(internal.socialSync.run, { auto });
  },
});

export const status = query({
  args: {},
  handler: async ctx => {
    await requireCrmPermission(ctx, "mesoutils:actualites", "read");
    const state = await ctx.db.query("socialSyncState").withIndex("by_key", q => q.eq("key", "global")).unique();
    return state ? { finishedAt: state.finishedAt, errors: state.errors ?? [], running: state.leaseUntil > Date.now() } : null;
  },
});

export const saveProfile = internalMutation({
  args: { pageId: v.id("socialFacebookPages"), network: networkValidator, imageUrl: v.string() },
  handler: async (ctx, { pageId, network, imageUrl }) => {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.searchParams.has("access_token")) return;
    if (network === "facebook") await ctx.db.patch(pageId, { profileImageUrl: imageUrl, profileCheckedAt: Date.now() });
    else await ctx.db.patch(pageId, { instagramProfileImageUrl: imageUrl, instagramProfileCheckedAt: Date.now() });
  },
});
