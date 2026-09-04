import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCrmPermission } from "./lib";

export const list = query({ args: { from: v.number(), to: v.number() }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "read");
  const events = await ctx.db.query("recycappCalendarEvents").withIndex("by_startAt", (q) => q.gte("startAt", args.from).lte("startAt", args.to)).collect();
  return Promise.all(events.map(async (event) => ({ ...event, attachmentUrls: await Promise.all(event.attachments.map((id) => ctx.storage.getUrl(id))) })));
} });
export const create = mutation({ args: { title: v.string(), startAt: v.number(), endAt: v.number(), attachments: v.array(v.id("_storage")), urls: v.array(v.string()) }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "create");
  if (!args.title.trim() || args.endAt <= args.startAt) throw new Error("Renseignez un intitulé et des dates valides.");
  return await ctx.db.insert("recycappCalendarEvents", { ...args, title: args.title.trim(), createdAt: Date.now() });
} });
export const remove = mutation({ args: { id: v.id("recycappCalendarEvents") }, handler: async (ctx, args) => { await requireCrmPermission(ctx, "calendrier", "delete"); await ctx.db.delete(args.id); } });
