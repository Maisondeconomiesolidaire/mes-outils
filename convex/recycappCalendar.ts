import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCrmPermission } from "./lib";

export const list = query({ args: { from: v.number(), to: v.number() }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "read");
  const events = await ctx.db.query("recycappCalendarEvents").withIndex("by_startAt", (q) => q.gte("startAt", args.from).lte("startAt", args.to)).collect();
  return Promise.all(events.map(async (event) => ({ ...event, attachmentUrls: await Promise.all(event.attachments.map((id) => ctx.storage.getUrl(id))) })));
} });
export const create = mutation({ args: { title: v.string(), animationType: v.optional(v.string()), structure: v.optional(v.string()), activity: v.optional(v.string()), location: v.optional(v.string()), relatedEvent: v.optional(v.string()), targetAudience: v.optional(v.string()), organizer: v.optional(v.string()), completed: v.optional(v.boolean()), startAt: v.number(), endAt: v.number(), attachments: v.array(v.id("_storage")), urls: v.array(v.string()) }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "create");
  if (!args.title.trim() || args.endAt <= args.startAt) throw new Error("Renseignez un intitulé et des dates valides.");
  return await ctx.db.insert("recycappCalendarEvents", { ...args, title: args.title.trim(), createdAt: Date.now() });
} });
export const remove = mutation({ args: { id: v.id("recycappCalendarEvents") }, handler: async (ctx, args) => { await requireCrmPermission(ctx, "calendrier", "delete"); await ctx.db.delete(args.id); } });

/** Champs d'un évènement dont les valeurs sont choisies dans une liste. */
const OPTION_FIELD = v.union(v.literal("animationType"), v.literal("structure"), v.literal("activity"), v.literal("targetAudience"));

export const options = query({ args: {}, handler: async (ctx) => {
  await requireCrmPermission(ctx, "calendrier", "read");
  const rows = await ctx.db.query("recycappCalendarOptions").collect();
  return rows.map((row) => ({ field: row.field, label: row.label }));
} });

/** Ajoute une option de liste déroulante, visible ensuite par toute l'équipe. */
export const addOption = mutation({ args: { field: OPTION_FIELD, label: v.string() }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "create");
  const label = args.label.trim();
  if (!label) throw new Error("Renseignez le libellé de l'option.");
  const existing = await ctx.db.query("recycappCalendarOptions").withIndex("by_field", (q) => q.eq("field", args.field)).collect();
  if (existing.some((row) => row.label.toLowerCase() === label.toLowerCase())) return label;
  await ctx.db.insert("recycappCalendarOptions", { field: args.field, label, createdAt: Date.now() });
  return label;
} });
