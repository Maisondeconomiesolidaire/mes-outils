import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUser } from "./lib";

/**
 * Miniatures des photos affichées en grille (~480 px, quelques dizaines de Ko).
 *
 * Les URL de stockage Convex ne passent par aucun CDN : une carte de 300 px qui
 * charge la photo pleine taille facture des centaines de Ko de bande passante
 * sortante à chaque visiteur. Le runtime Convex n'a pas d'encodeur d'image, donc
 * c'est le navigateur qui produit la miniature à l'envoi et l'enregistre ici.
 */

/** URL de la miniature d'une photo, ou de la photo elle-même à défaut. */
export async function thumbnailUrl(ctx: QueryCtx, source: Id<"_storage">) {
  const row = await ctx.db
    .query("storageThumbnails")
    .withIndex("by_source", (q) => q.eq("source", source))
    .unique();
  return (row && (await ctx.storage.getUrl(row.thumb))) ?? (await ctx.storage.getUrl(source));
}

export const register = mutation({
  args: { source: v.id("_storage"), thumb: v.id("_storage") },
  handler: async (ctx, { source, thumb }) => {
    await requireUser(ctx);
    const existing = await ctx.db
      .query("storageThumbnails")
      .withIndex("by_source", (q) => q.eq("source", source))
      .unique();
    if (existing || !(await ctx.db.system.get("_storage", source))) {
      await ctx.storage.delete(thumb);
      return;
    }
    await ctx.db.insert("storageThumbnails", { source, thumb });
  },
});

/** Supprime les miniatures dont la photo d'origine n'existe plus. */
export const cleanup = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("storageThumbnails")
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    for (const row of page.page) {
      if (await ctx.db.system.get("_storage", row.source)) continue;
      if (await ctx.db.system.get("_storage", row.thumb)) await ctx.storage.delete(row.thumb);
      await ctx.db.delete(row._id);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.thumbnails.cleanup, { cursor: page.continueCursor });
    }
  },
});
