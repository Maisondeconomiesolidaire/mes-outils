import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";

/**
 * Durée hebdomadaire de travail d'un salarié, en heures.
 *
 * Le contrat RH fait foi (base « un mois = 4 semaines », comme la page Agents
 * polyvalents) ; à défaut, la somme des créneaux de son planning hebdomadaire.
 * `null` quand aucune des deux sources n'est renseignée : un pourcentage de
 * temps alloué n'aurait alors aucun sens.
 */
async function weeklyHours(ctx: QueryCtx, worker: Doc<"polyvalentWorkers">) {
  if (worker.monthlyHours) return worker.monthlyHours / 4;
  const schedule = await ctx.db.query("polyvalentWorkerSchedules").withIndex("by_worker", (q) => q.eq("workerId", worker._id)).unique();
  if (!schedule) return null;
  const total = schedule.availability.reduce((hours, slot) => {
    const [startHour, startMinute] = slot.start.split(":").map(Number);
    const [endHour, endMinute] = slot.end.split(":").map(Number);
    return hours + Math.max(0, (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60);
  }, 0);
  return total > 0 ? total : null;
}

/** Salariés affectés à un évènement, avec leur durée hebdomadaire. */
async function eventWorkers(ctx: QueryCtx, workerIds: Id<"polyvalentWorkers">[] | undefined) {
  if (!workerIds?.length) return [];
  const workers = await Promise.all(workerIds.map((id) => ctx.db.get(id)));
  return Promise.all(
    workers.filter((worker): worker is Doc<"polyvalentWorkers"> => worker !== null).map(async (worker) => ({
      _id: worker._id,
      name: `${worker.firstName} ${worker.lastName}`.trim(),
      weeklyHours: await weeklyHours(ctx, worker),
    })),
  );
}

export const list = query({ args: { from: v.number(), to: v.number() }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "read");
  const events = await ctx.db.query("recycappCalendarEvents").withIndex("by_startAt", (q) => q.gte("startAt", args.from).lte("startAt", args.to)).collect();
  return Promise.all(events.map(async (event) => ({
    ...event,
    attachmentUrls: await Promise.all(event.attachments.map((id) => ctx.storage.getUrl(id))),
    workers: await eventWorkers(ctx, event.workerIds),
  })));
} });
export const create = mutation({ args: { title: v.string(), animationType: v.optional(v.string()), structure: v.optional(v.string()), activity: v.optional(v.string()), location: v.optional(v.string()), relatedEvent: v.optional(v.string()), targetAudience: v.optional(v.string()), organizer: v.optional(v.string()), completed: v.optional(v.boolean()), workerIds: v.optional(v.array(v.id("polyvalentWorkers"))), startAt: v.number(), endAt: v.number(), attachments: v.array(v.id("_storage")), urls: v.array(v.string()) }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "create");
  if (!args.title.trim() || args.endAt <= args.startAt) throw new Error("Renseignez un intitulé et des dates valides.");
  return await ctx.db.insert("recycappCalendarEvents", { ...args, title: args.title.trim(), createdAt: Date.now() });
} });
/**
 * Équipe attribuable à un évènement : salariés actifs, avec leur durée
 * hebdomadaire. Lisible avec la seule permission « calendrier » — la page
 * Agents polyvalents n'est pas ouverte à tout le monde.
 */
export const assignableWorkers = query({ args: {}, handler: async (ctx) => {
  await requireCrmPermission(ctx, "calendrier", "read");
  const workers = await ctx.db.query("polyvalentWorkers").take(1000);
  const active = workers.filter((worker) => worker.activeOverride ?? worker.active ?? true);
  const withHours = await Promise.all(active.map(async (worker) => ({
    _id: worker._id,
    name: `${worker.firstName} ${worker.lastName}`.trim(),
    firstName: worker.firstName,
    lastName: worker.lastName,
    email: worker.email,
    sites: worker.sites,
    employmentType: worker.employmentType,
    weeklyHours: await weeklyHours(ctx, worker),
  })));
  return withHours.sort((a, b) => a.name.localeCompare(b.name, "fr"));
} });

/** Réattribue l'évènement à une nouvelle liste de salariés. */
export const setWorkers = mutation({ args: { id: v.id("recycappCalendarEvents"), workerIds: v.array(v.id("polyvalentWorkers")) }, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, "calendrier", "update");
  if (!await ctx.db.get(args.id)) throw new Error("Évènement introuvable.");
  await ctx.db.patch(args.id, { workerIds: args.workerIds });
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
