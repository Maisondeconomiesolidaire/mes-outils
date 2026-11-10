import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hasCrmPermission, requireCrmPermission, requireUser } from "./lib";
import { thumbnailUrl } from "./thumbnails";
import type { QueryCtx } from "./_generated/server";
import { transportRoute, validTransition } from "./meslogisticRules";
const PAGE = "meslogistic:demandes";
async function event(ctx: MutationCtx, requestId: Id<"mlRequests">, message: string, actor: string) {
  await ctx.db.insert("mlEvents", { requestId, message, actor, createdAt: Date.now() });
}
/** Called in the order transaction: atomic and idempotent, including Stripe retries. */
export async function ensureOrderTransport(ctx: MutationCtx, orderId: Id<"btOrders">, options: { dueDate?: string; actor?: string } = {}) {
  const order = await ctx.db.get(orderId);
  if (!order || !["payee", "reservee"].includes(order.status)) return;
  if (await ctx.db.query("mlRequests").withIndex("by_orderId", q => q.eq("orderId", orderId)).first()) return;
  const material = await ctx.db.get(order.materialId);
  const route = transportRoute(order.logisticsSourceDepot ?? material?.depot, order.pickupLocation);
  if (!route) return;
  const now = Date.now();
  const id = await ctx.db.insert("mlRequests", {
    orderId, materialId: order.materialId, reference: order.pickupReference ?? order.reference,
    title: order.materialTitle, quantity: order.quantity, unit: order.unit,
    customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
    ...route, status: "a_preparer", prepared: false, dueDate: options.dueDate, createdAt: now, updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.batireEmails.sendMeslogisticNewRequest, { reference: order.pickupReference ?? order.reference, title: order.materialTitle, quantity: order.quantity, unit: order.unit, customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(), origin: route.origin, destination: route.destination, dueDate: options.dueDate, source: "Bâtire" });
  await event(ctx, id, options.dueDate ? `Demande d’enlèvement créée depuis Bâtire ${order.pickupReference ?? order.reference} · échéance ${options.dueDate}` : `Demande créée depuis la commande Bâtire ${order.reference}`, options.actor ?? "Bâtire");
  return id;
}
/** Miniature de la première photo de l'article Bâtire transporté (null pour une demande interne). */
export async function materialPhoto(ctx: QueryCtx, materialId?: Id<"btMaterials">) {
  if (!materialId) return null;
  const material = await ctx.db.get(materialId);
  return material?.photos[0] ? await thumbnailUrl(ctx, material.photos[0]) : null;
}
export const list = query({
  args: {}, handler: async ctx => {
    await requireCrmPermission(ctx, PAGE, "read");
    const rows = await ctx.db.query("mlRequests").order("desc").take(500);
    // Meslogistic ne gère que la logistique : aucun statut de paiement n'est exposé ici.
    return await Promise.all(rows.map(async row => {
      const order = row.orderId ? await ctx.db.get(row.orderId) : null;
      return { ...row, collected: Boolean(order?.collectedAt), photoUrl: await materialPhoto(ctx, row.materialId) };
    }));
  },
});
/** Badge de navigation : demandes nouvelles, sans navette assignée. 0 sans droit de lecture. */
export const badgeCount = query({
  args: {}, handler: async ctx => {
    if (!(await hasCrmPermission(ctx, PAGE, "read"))) return 0;
    const rows = await ctx.db.query("mlRequests").order("desc").take(500);
    return rows.filter(row => row.status === "a_preparer" && !row.shuttleId).length;
  },
});
export const history = query({
  args: { id: v.id("mlRequests") }, handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, PAGE, "read");
    return await ctx.db.query("mlEvents").withIndex("by_requestId", q => q.eq("requestId", id)).order("desc").take(200);
  },
});
export const listShuttles = query({
  args: {}, handler: async ctx => {
    await requireCrmPermission(ctx, PAGE, "read");
    return await ctx.db.query("mlShuttles").order("desc").take(200);
  },
});
/** Navettes avec l’aperçu des transits déjà affectés (page Navettes et fenêtre d’affectation). */
export const shuttlesOverview = query({
  args: {}, handler: async ctx => {
    await requireCrmPermission(ctx, PAGE, "read");
    const shuttles = await ctx.db.query("mlShuttles").order("desc").take(200);
    return await Promise.all(shuttles.map(async shuttle => {
      const transits = await ctx.db.query("mlRequests").withIndex("by_shuttleId", q => q.eq("shuttleId", shuttle._id)).take(200);
      return {
        ...shuttle,
        transits: transits.map(r => ({ _id: r._id, reference: r.reference, title: r.title, quantity: r.quantity, unit: r.unit, customerName: r.customerName, origin: r.origin, destination: r.destination, status: r.status, fromOrder: Boolean(r.orderId) })),
      };
    }));
  },
});
const isoDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const createShuttle = mutation({
  args: { name: v.string(), scheduledDate: v.string(), origin: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE, "create");
    const name = args.name.trim();
    if (!name || name.length > 100) throw new ConvexError("Donnez un nom à la navette (100 caractères maximum).");
    if (!isoDate(args.scheduledDate)) throw new ConvexError("Choisissez une date valide.");
    const origin = args.origin?.trim();
    if (origin !== undefined && (!origin || origin.length > 300)) throw new ConvexError("Indiquez le lieu de départ de la navette.");
    return await ctx.db.insert("mlShuttles", { name, scheduledDate: args.scheduledDate, origin, createdAt: Date.now() });
  },
});
/** Affecte (ou retire) un transit à une navette : la date prévue devient celle de la navette. */
export const assignShuttle = mutation({
  args: { id: v.id("mlRequests"), shuttleId: v.union(v.id("mlShuttles"), v.null()), expectedUpdatedAt: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.updatedAt !== args.expectedUpdatedAt) throw new ConvexError("La demande a changé. Actualisez la fiche.");
    if (row.status !== "a_preparer") throw new ConvexError("Ce transit est déjà parti ou clôturé.");
    const updatedAt = Math.max(Date.now(), row.updatedAt + 1);
    if (args.shuttleId) {
      const shuttle = await ctx.db.get(args.shuttleId);
      if (!shuttle) throw new ConvexError("Navette introuvable.");
      await ctx.db.patch(row._id, { shuttleId: shuttle._id, scheduledDate: shuttle.scheduledDate, prepared: true, updatedAt });
      await event(ctx, row._id, `Affecté à la navette « ${shuttle.name} » du ${shuttle.scheduledDate}`, user.name ?? user.subject);
    } else {
      if (!row.shuttleId) return { updatedAt: row.updatedAt };
      await ctx.db.patch(row._id, { shuttleId: undefined, updatedAt });
      await event(ctx, row._id, "Retiré de sa navette", user.name ?? user.subject);
    }
    return { updatedAt };
  },
});

export const schedule = mutation({
  args: { id: v.id("mlRequests"), scheduledDate: v.string(), expectedUpdatedAt: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.updatedAt !== args.expectedUpdatedAt) throw new ConvexError("La demande a changé. Actualisez la fiche.");
    if (row.status !== "a_preparer") throw new ConvexError("Cette demande est déjà partie ou clôturée.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.scheduledDate) || !Number.isFinite(Date.parse(args.scheduledDate)) || new Date(args.scheduledDate).toISOString().slice(0, 10) !== args.scheduledDate) throw new ConvexError("Choisissez une date valide.");
    if (row.shuttleId && row.scheduledDate !== args.scheduledDate) throw new ConvexError("Réaffectez une navette pour modifier sa date.");
    const updatedAt = Math.max(Date.now(), row.updatedAt + 1);
    await ctx.db.patch(row._id, { scheduledDate: args.scheduledDate, prepared: true, updatedAt });
    await event(ctx, row._id, `Date programmée : ${args.scheduledDate}`, user.name ?? user.subject);
    return { updatedAt };
  },
});
const fields = { title: v.string(), quantity: v.number(), unit: v.string(), customerName: v.string(), origin: v.string(), destination: v.string(), scheduledDate: v.optional(v.string()), dueDate: v.optional(v.string()), assignee: v.optional(v.string()), notes: v.optional(v.string()) };
function validateFields(args: { title: string; quantity: number; unit: string; origin: string; destination: string; scheduledDate?: string; dueDate?: string; notes?: string }) {
  if (![args.title, args.unit, args.origin, args.destination].every(x => x.trim()) || !Number.isFinite(args.quantity) || args.quantity <= 0) throw new ConvexError("Renseignez l’objet, la quantité et les deux lieux.");
  if (args.origin.trim().toLocaleLowerCase() === args.destination.trim().toLocaleLowerCase()) throw new ConvexError("Le départ et l’arrivée doivent être différents.");
  if (args.scheduledDate && (!/^\d{4}-\d{2}-\d{2}$/.test(args.scheduledDate) || !Number.isFinite(Date.parse(args.scheduledDate)))) throw new ConvexError("Date invalide.");
  if (args.dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueDate) || !Number.isFinite(Date.parse(args.dueDate)))) throw new ConvexError("Échéance invalide.");
  if ((args.notes?.length ?? 0) > 5000 || [args.title, args.origin, args.destination].some(x => x.length > 300)) throw new ConvexError("Texte trop long.");
}
export const create = mutation({ args: fields, handler: async (ctx, args) => {
  await requireCrmPermission(ctx, PAGE, "create");
  if (!args.dueDate) throw new ConvexError("Indiquez l’échéance : date à laquelle les objets doivent être arrivés.");
  validateFields(args);
  const user = await requireUser(ctx); const now = Date.now();
  const id = await ctx.db.insert("mlRequests", { ...args, reference: `ML-${now}`, status: "a_preparer", prepared: false, createdAt: now, updatedAt: now });
  await ctx.db.patch(id, { reference: `ML-${id}` });
  await ctx.scheduler.runAfter(0, internal.batireEmails.sendMeslogisticNewRequest, { reference: `ML-${id}`, title: args.title, quantity: args.quantity, unit: args.unit, customerName: args.customerName, origin: args.origin, destination: args.destination, dueDate: args.dueDate, source: `créée par ${user.name ?? user.email ?? "l’équipe"}` });
  await event(ctx, id, "Demande manuelle créée", user.name ?? user.subject); return id;
}});
export const update = mutation({
  args: { id: v.id("mlRequests"), origin: v.string(), destination: v.string(), scheduledDate: v.string(), dueDate: v.optional(v.string()), assignee: v.string(), notes: v.string(), expectedUpdatedAt: v.number() },
  handler: async (ctx, { id, expectedUpdatedAt, ...args }) => {
    await requireCrmPermission(ctx, PAGE, "update"); const user = await requireUser(ctx);
    const row = await ctx.db.get(id); if (!row) throw new ConvexError("Demande introuvable.");
    if (row.updatedAt !== expectedUpdatedAt) throw new ConvexError("La demande a changé. Fermez puis rouvrez la fiche.");
    if (["receptionnee", "annulee"].includes(row.status)) throw new ConvexError("Cette demande est clôturée.");
    if (row.status === "en_transit" && (args.origin !== row.origin || args.destination !== row.destination)) throw new ConvexError("Le trajet est figé pendant le transport.");
    if (row.orderId && (args.origin !== row.origin || args.destination !== row.destination)) throw new ConvexError("Le trajet est lié au retrait Bâtire et ne peut pas être modifié ici.");
    if (row.shuttleId && args.scheduledDate !== row.scheduledDate) throw new ConvexError("Réaffectez une navette pour modifier la date prévue.");
    if (args.dueDate !== undefined && !args.dueDate) throw new ConvexError("L’échéance est obligatoire.");
    if (args.dueDate === undefined) delete args.dueDate;
    validateFields({ ...row, ...args });
    await ctx.db.patch(id, { ...args, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
    await event(ctx, id, `Organisation mise à jour · ${args.origin} → ${args.destination} · ${args.scheduledDate || "sans date"} · ${args.assignee || "non attribuée"}${args.notes !== (row.notes ?? "") ? ` · Note : ${args.notes || "effacée"}` : ""}`, user.name ?? user.subject);
  },
});
export const advance = mutation({
  args: { id: v.id("mlRequests"), step: v.union(v.literal("prepared"), v.literal("en_transit"), v.literal("receptionnee"), v.literal("annulee")), expectedUpdatedAt: v.number() },
  handler: async (ctx, { id, step, expectedUpdatedAt }) => {
    await requireCrmPermission(ctx, PAGE, "update"); const user = await requireUser(ctx);
    const row = await ctx.db.get(id); if (!row) throw new ConvexError("Demande introuvable.");
    if (row.updatedAt !== expectedUpdatedAt) throw new ConvexError("La demande a changé. Actualisez la fiche.");
    if (step === "prepared") {
      if (row.status !== "a_preparer" || row.prepared) throw new ConvexError("Cette étape est déjà terminée.");
      if (row.origin === "Lieu de départ à préciser") throw new ConvexError("Précisez le lieu de départ avant la préparation.");
      await ctx.db.patch(id, { prepared: true, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
    } else {
      if (step === "en_transit" && !row.scheduledDate) throw new ConvexError("Programmez une date avant le départ.");
      if (step === "en_transit" && row.orderId && !row.shuttleId) throw new ConvexError("Affectez une navette avant le départ.");
      if (!validTransition(row.status, step, row.prepared)) throw new ConvexError("Respectez l’ordre des étapes du transport.");
      await ctx.db.patch(id, { status: step, ...(step === "receptionnee" ? { receivedQuantity: row.quantity, receivedAt: Date.now() } : {}), updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
    }
    const labels = { prepared: "Objets préparés", en_transit: "Objets en transit", receptionnee: "Objets réceptionnés", annulee: "Demande annulée" };
    await event(ctx, id, labels[step], user.name ?? user.subject);
    return { updatedAt: (await ctx.db.get(id))!.updatedAt };
  },
});
