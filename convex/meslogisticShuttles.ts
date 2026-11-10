/**
 * Meslogistic « Demandes v2 » : la navette est l'unité de travail.
 *
 * On crée une navette (nom + date), on y ajoute des demandes, puis la navette
 * change de statut d'un bloc : « Départ » met toutes ses demandes en transit,
 * « Arrivée » les déclare toutes disponibles à destination. Les demandes
 * Bâtire suivent automatiquement (leur transit passe par les mêmes statuts).
 */
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCrmPermission, requireUser } from "./lib";

const PAGE = "meslogistic:demandes";
type ShuttleStatus = "planifiee" | "en_route" | "terminee";

/** Statut d'une navette : explicite, ou déduit de ses demandes pour les navettes d'avant la v2. */
function shuttleStatus(shuttle: Doc<"mlShuttles">, transits: Doc<"mlRequests">[]): ShuttleStatus {
  if (shuttle.status) return shuttle.status;
  const live = transits.filter(row => row.status !== "annulee");
  if (live.length && live.every(row => row.status === "receptionnee")) return "terminee";
  if (live.some(row => row.status === "en_transit")) return "en_route";
  return "planifiee";
}

async function log(ctx: MutationCtx, requestId: Id<"mlRequests">, message: string, actor: string) {
  await ctx.db.insert("mlEvents", { requestId, message, actor, createdAt: Date.now() });
}

const transitView = (row: Doc<"mlRequests">) => ({
  _id: row._id, reference: row.reference, title: row.title, quantity: row.quantity, unit: row.unit,
  customerName: row.customerName, origin: row.origin, destination: row.destination, dueDate: row.dueDate,
  status: row.status, fromOrder: Boolean(row.orderId), notes: row.notes,
  loadedAt: row.loadedAt, loadedBy: row.loadedBy,
});

/** Tableau des navettes et des demandes encore sans navette. */
export const board = query({
  args: {},
  handler: async ctx => {
    await requireCrmPermission(ctx, PAGE, "read");
    const shuttles = await ctx.db.query("mlShuttles").order("desc").take(200);
    const rows = await Promise.all(shuttles.map(async shuttle => {
      const transits = (await ctx.db.query("mlRequests").withIndex("by_shuttleId", q => q.eq("shuttleId", shuttle._id)).take(100)).filter(row => row.status !== "annulee");
      return { _id: shuttle._id, name: shuttle.name, scheduledDate: shuttle.scheduledDate, status: shuttleStatus(shuttle, transits), departedAt: shuttle.departedAt, completedAt: shuttle.completedAt, transits: transits.map(transitView) };
    }));
    const unassigned = (await ctx.db.query("mlRequests").withIndex("by_status", q => q.eq("status", "a_preparer")).take(300)).filter(row => !row.shuttleId);
    return { shuttles: rows, unassigned: unassigned.map(transitView) };
  },
});

async function loadShuttle(ctx: MutationCtx, shuttleId: Id<"mlShuttles">) {
  const shuttle = await ctx.db.get(shuttleId);
  if (!shuttle) throw new ConvexError("Navette introuvable.");
  const transits = (await ctx.db.query("mlRequests").withIndex("by_shuttleId", q => q.eq("shuttleId", shuttleId)).take(100)).filter(row => row.status !== "annulee");
  return { shuttle, transits, status: shuttleStatus(shuttle, transits) };
}

/** Ajoute des demandes (nouvelles, sans navette) à une navette planifiée. */
export const addRequests = mutation({
  args: { shuttleId: v.id("mlShuttles"), requestIds: v.array(v.id("mlRequests")) },
  handler: async (ctx, { shuttleId, requestIds }) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    if (!requestIds.length || requestIds.length > 50) throw new ConvexError("Sélectionnez entre 1 et 50 demandes.");
    const { shuttle, status } = await loadShuttle(ctx, shuttleId);
    if (status !== "planifiee") throw new ConvexError("Cette navette est déjà partie : on ne peut plus y ajouter de demandes.");
    const now = Date.now();
    for (const id of requestIds) {
      const row = await ctx.db.get(id);
      if (!row || row.status !== "a_preparer") throw new ConvexError("Une des demandes n’est plus disponible. Actualisez la page.");
      if (row.shuttleId && row.shuttleId !== shuttleId) throw new ConvexError(`La demande ${row.reference} est déjà dans une autre navette.`);
      await ctx.db.patch(id, { shuttleId, scheduledDate: shuttle.scheduledDate, prepared: true, updatedAt: Math.max(now, row.updatedAt + 1) });
      await log(ctx, id, `Ajoutée à la navette « ${shuttle.name} » du ${shuttle.scheduledDate}`, user.name ?? user.subject);
    }
  },
});

/** Retire une demande d'une navette pas encore partie : elle revient « À planifier ». */
export const removeRequest = mutation({
  args: { requestId: v.id("mlRequests") },
  handler: async (ctx, { requestId }) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const row = await ctx.db.get(requestId);
    if (!row?.shuttleId) return;
    if (row.status !== "a_preparer") throw new ConvexError("Cette demande est déjà partie.");
    const shuttle = await ctx.db.get(row.shuttleId);
    await ctx.db.patch(requestId, { shuttleId: undefined, scheduledDate: undefined, prepared: false, loadedAt: undefined, loadedBy: undefined, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
    await log(ctx, requestId, `Retirée de la navette « ${shuttle?.name ?? "?"} »`, user.name ?? user.subject);
  },
});

/** Modifie le nom ou la date d'une navette planifiée ; ses demandes prennent la nouvelle date. */
export const updateShuttle = mutation({
  args: { shuttleId: v.id("mlShuttles"), name: v.string(), scheduledDate: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const name = args.name.trim();
    if (!name || name.length > 100) throw new ConvexError("Donnez un nom à la navette (100 caractères maximum).");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.scheduledDate) || !Number.isFinite(Date.parse(args.scheduledDate))) throw new ConvexError("Choisissez une date valide.");
    const { transits, status } = await loadShuttle(ctx, args.shuttleId);
    if (status !== "planifiee") throw new ConvexError("Cette navette est déjà partie.");
    await ctx.db.patch(args.shuttleId, { name, scheduledDate: args.scheduledDate });
    const now = Date.now();
    for (const row of transits) await ctx.db.patch(row._id, { scheduledDate: args.scheduledDate, updatedAt: Math.max(now, row.updatedAt + 1) });
  },
});

/** Supprime une navette planifiée : ses demandes reviennent « À planifier ». */
export const deleteShuttle = mutation({
  args: { shuttleId: v.id("mlShuttles") },
  handler: async (ctx, { shuttleId }) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const { shuttle, transits, status } = await loadShuttle(ctx, shuttleId);
    if (status !== "planifiee") throw new ConvexError("Une navette partie ne peut pas être supprimée.");
    const now = Date.now();
    for (const row of transits) {
      await ctx.db.patch(row._id, { shuttleId: undefined, scheduledDate: undefined, prepared: false, loadedAt: undefined, loadedBy: undefined, updatedAt: Math.max(now, row.updatedAt + 1) });
      await log(ctx, row._id, `Navette « ${shuttle.name} » supprimée : demande à replanifier`, user.name ?? user.subject);
    }
    await ctx.db.delete(shuttleId);
  },
});

/**
 * Confirme (ou annule) qu'un objet est bien chargé dans sa navette. Sans
 * `requestId`, confirme tous les objets de la navette d'un coup.
 */
export const setLoaded = mutation({
  args: { shuttleId: v.id("mlShuttles"), requestId: v.optional(v.id("mlRequests")), loaded: v.boolean() },
  handler: async (ctx, { shuttleId, requestId, loaded }) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const { shuttle, transits, status } = await loadShuttle(ctx, shuttleId);
    if (status !== "planifiee") throw new ConvexError("Cette navette est déjà partie.");
    const targets = transits.filter(row => row.status === "a_preparer" && (!requestId || row._id === requestId));
    if (requestId && !targets.length) throw new ConvexError("Cet objet n’est pas dans cette navette.");
    const now = Date.now();
    const actor = user.name ?? user.subject;
    for (const row of targets) {
      if (Boolean(row.loadedAt) === loaded) continue;
      await ctx.db.patch(row._id, loaded ? { loadedAt: now, loadedBy: actor } : { loadedAt: undefined, loadedBy: undefined });
      await log(ctx, row._id, loaded ? `Chargement confirmé dans la navette « ${shuttle.name} »` : `Chargement annulé (navette « ${shuttle.name} »)`, actor);
    }
  },
});

/** Départ : la navette part, toutes ses demandes passent en transit. */
export const departShuttle = mutation({
  args: { shuttleId: v.id("mlShuttles") },
  handler: async (ctx, { shuttleId }) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const { shuttle, transits, status } = await loadShuttle(ctx, shuttleId);
    if (status !== "planifiee") throw new ConvexError("Cette navette est déjà partie.");
    if (!transits.length) throw new ConvexError("Ajoutez au moins une demande avant le départ.");
    const missing = transits.filter(row => row.status === "a_preparer" && !row.loadedAt);
    if (missing.length) throw new ConvexError(`Confirmez le chargement de tous les objets avant le départ (${missing.length} restant${missing.length > 1 ? "s" : ""} : ${missing.slice(0, 3).map(row => row.reference).join(", ")}${missing.length > 3 ? "…" : ""}).`);
    const now = Date.now();
    for (const row of transits.filter(item => item.status === "a_preparer")) {
      await ctx.db.patch(row._id, { status: "en_transit", prepared: true, updatedAt: Math.max(now, row.updatedAt + 1) });
      await log(ctx, row._id, `En transit · départ de la navette « ${shuttle.name} »`, user.name ?? user.subject);
    }
    await ctx.db.patch(shuttleId, { status: "en_route", departedAt: now });
  },
});

/**
 * Arrivée : toutes les demandes de la navette sont livrées (disponibles à
 * destination). `requestIds` permet de n'en déclarer que certaines : la
 * navette se termine quand il ne reste plus rien en transit.
 */
export const deliverShuttle = mutation({
  args: { shuttleId: v.id("mlShuttles"), requestIds: v.optional(v.array(v.id("mlRequests"))) },
  handler: async (ctx, { shuttleId, requestIds }) => {
    await requireCrmPermission(ctx, PAGE, "update");
    const user = await requireUser(ctx);
    const { shuttle, transits, status } = await loadShuttle(ctx, shuttleId);
    if (status !== "en_route") throw new ConvexError("La navette doit être en route pour déclarer une arrivée.");
    const now = Date.now();
    const targets = transits.filter(row => row.status === "en_transit" && (!requestIds || requestIds.includes(row._id)));
    for (const row of targets) {
      await ctx.db.patch(row._id, { status: "receptionnee", receivedQuantity: row.quantity, receivedAt: now, updatedAt: Math.max(now, row.updatedAt + 1) });
      await log(ctx, row._id, `Livrée · navette « ${shuttle.name} »`, user.name ?? user.subject);
    }
    const remaining = transits.filter(row => row.status === "en_transit" && !targets.some(target => target._id === row._id));
    if (!remaining.length) await ctx.db.patch(shuttleId, { status: "terminee", completedAt: now });
  },
});
