/**
 * Onglet « Navettes » de Mes Outils.
 *
 * Quand un salarié réserve un véhicule, il indique sa destination. Son trajet
 * part toujours du Solidarium (Lachapelle-aux-Pots) et y revient. On regarde
 * quels sites logistiques (Comptoir C à Beauvais, Esspace 150 à Gournay) sont
 * sur sa route, et donc quels transits Meslogistic en attente il peut emporter.
 * Quand il « prend » des objets, une navette Meslogistic à son nom est créée
 * pour la date de sa réservation : elle apparaît dans le calendrier Meslogistic.
 */
import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCrmPermission, requireUser } from "./lib";
import { materialPhoto } from "./meslogistic";
import { canonicalLocation, LOCATIONS } from "./meslogisticRules";
import { shuttleStatus } from "./meslogisticShuttles";
import {
  HOME_SITE,
  isOnRoute,
  isSiteKey,
  maxDetourKm,
  parisDay,
  roundTripKm,
  SITE_KEYS,
  SITES,
  transitOnRoute,
} from "./lib/navettesRoute";

const PAGE_KEY = "mesoutils:reservations";
const MAPBOX = "https://api.mapbox.com";

function mapboxToken(): string {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) throw new ConvexError("La recherche de lieux n'est pas configurée (MAPBOX_ACCESS_TOKEN).");
  return token;
}

// ─── Recherche de lieux (lieux et adresses, ex. « Starbucks ») ───────────────

export const searchPlaces = action({
  args: { q: v.string(), sessionToken: v.string() },
  handler: async (ctx, { q, sessionToken }) => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Non authentifié.");
    const query = q.trim().slice(0, 200);
    if (query.length < 2) return [];
    const url = new URL(`${MAPBOX}/search/searchbox/v1/suggest`);
    url.searchParams.set("q", query);
    url.searchParams.set("language", "fr");
    url.searchParams.set("country", "FR");
    url.searchParams.set("limit", "7");
    url.searchParams.set("proximity", `${SITES[HOME_SITE].longitude},${SITES[HOME_SITE].latitude}`);
    url.searchParams.set("session_token", sessionToken.slice(0, 64));
    url.searchParams.set("access_token", mapboxToken());
    const response = await fetch(url.toString());
    const payload = (await response.json()) as {
      message?: string;
      suggestions?: Array<{ mapbox_id: string; name: string; full_address?: string; place_formatted?: string; feature_type: string; poi_category?: string[] }>;
    };
    if (!response.ok) throw new ConvexError(payload.message || "Recherche de lieux impossible.");
    return (payload.suggestions ?? []).map((s) => ({
      id: s.mapbox_id,
      name: s.name,
      address: s.full_address ?? s.place_formatted ?? "",
      kind: s.feature_type,
      category: s.poi_category?.[0],
    }));
  },
});

export const retrievePlace = action({
  args: { id: v.string(), sessionToken: v.string() },
  handler: async (ctx, { id, sessionToken }) => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Non authentifié.");
    const url = new URL(`${MAPBOX}/search/searchbox/v1/retrieve/${encodeURIComponent(id)}`);
    url.searchParams.set("language", "fr");
    url.searchParams.set("session_token", sessionToken.slice(0, 64));
    url.searchParams.set("access_token", mapboxToken());
    const response = await fetch(url.toString());
    const payload = (await response.json()) as {
      message?: string;
      features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { name?: string; full_address?: string; place_formatted?: string } }>;
    };
    const feature = payload.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (!response.ok || !coordinates) throw new ConvexError(payload.message || "Lieu introuvable.");
    return {
      label: feature?.properties?.name ?? "Destination",
      address: feature?.properties?.full_address ?? feature?.properties?.place_formatted,
      longitude: coordinates[0],
      latitude: coordinates[1],
    };
  },
});

// ─── Calcul du trajet ─────────────────────────────────────────────────────────

async function drivingKm(points: Array<{ longitude: number; latitude: number }>): Promise<number> {
  const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const url = new URL(`${MAPBOX}/directions/v5/mapbox/driving/${coords}`);
  url.searchParams.set("overview", "false");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("access_token", mapboxToken());
  const response = await fetch(url.toString());
  const payload = (await response.json()) as { code?: string; message?: string; routes?: Array<{ distance?: number }> };
  if (!response.ok || payload.code !== "Ok" || !payload.routes?.length) {
    throw new ConvexError(payload.message || "Itinéraire introuvable vers cette destination.");
  }
  return (payload.routes[0].distance ?? 0) / 1000;
}

/**
 * Trajet Solidarium → destination (aller-retour) et sites logistiques sur la
 * route : un site l'est si y passer à l'aller ne coûte qu'un petit détour.
 */
export const planTrip = action({
  args: { longitude: v.number(), latitude: v.number() },
  handler: async (ctx, destination) => {
    if (!(await ctx.auth.getUserIdentity())) throw new ConvexError("Non authentifié.");
    if (!Number.isFinite(destination.longitude) || !Number.isFinite(destination.latitude)) throw new ConvexError("Destination invalide.");
    const home = SITES[HOME_SITE];
    const oneWayKm = await drivingKm([home, destination]);
    const others = SITE_KEYS.filter((key) => key !== HOME_SITE);
    const detours = await Promise.all(others.map(async (key) => {
      const viaKm = await drivingKm([home, SITES[key], destination]);
      const detourKm = Math.max(0, viaKm - oneWayKm);
      return { key, name: SITES[key].name, detourKm: Math.round(detourKm * 10) / 10, onRoute: isOnRoute(detourKm, oneWayKm) };
    }));
    return {
      oneWayKm: Math.round(oneWayKm * 10) / 10,
      roundTripKm: roundTripKm(oneWayKm),
      maxDetourKm: Math.round(maxDetourKm(oneWayKm)),
      sites: detours,
      sitesOnRoute: [HOME_SITE, ...detours.filter((d) => d.onRoute).map((d) => d.key)],
    };
  },
});

// ─── Données de l'onglet ──────────────────────────────────────────────────────

export const destinationValidator = v.object({
  label: v.string(),
  address: v.optional(v.string()),
  longitude: v.number(),
  latitude: v.number(),
});

export function cleanTrip(args: { destination?: Doc<"vehicleReservations">["destination"]; routeKm?: number; sitesOnRoute?: string[] }) {
  const destination = args.destination
    ? {
        label: args.destination.label.trim().slice(0, 200) || "Destination",
        address: args.destination.address?.trim().slice(0, 300) || undefined,
        longitude: args.destination.longitude,
        latitude: args.destination.latitude,
      }
    : undefined;
  if (destination && (!Number.isFinite(destination.longitude) || !Number.isFinite(destination.latitude))) {
    throw new ConvexError("Destination invalide.");
  }
  if (args.routeKm !== undefined && (!Number.isFinite(args.routeKm) || args.routeKm < 0 || args.routeKm > 20000)) {
    throw new ConvexError("Kilométrage du trajet invalide.");
  }
  const sitesOnRoute = args.sitesOnRoute ? [...new Set(args.sitesOnRoute.filter(isSiteKey))] : undefined;
  return { destination, routeKm: args.routeKm, sitesOnRoute };
}

function isParticipant(reservation: Doc<"vehicleReservations">, subject: string) {
  return reservation.clerkId === subject || reservation.bookedForClerkId === subject;
}

function isActive(reservation: Doc<"vehicleReservations">, now: number) {
  return (reservation.status === "pending" || reservation.status === "approved") && reservation.end > now;
}

async function transitRow(ctx: QueryCtx, row: Doc<"mlRequests">) {
  return {
    _id: row._id,
    reference: row.reference,
    title: row.title,
    quantity: row.quantity,
    unit: row.unit,
    origin: row.origin,
    destination: row.destination,
    originKey: canonicalLocation(row.origin) ?? null,
    destinationKey: canonicalLocation(row.destination) ?? null,
    dueDate: row.dueDate,
    status: row.status,
    loadedAt: row.loadedAt,
    photoUrl: await materialPhoto(ctx, row.materialId),
  };
}

/** Mes trajets à venir (réservations de véhicule en cours ou futures) et ce que j'y transporte. */
export const myTrips = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const now = Date.now();
    const [mine, forMe] = await Promise.all([
      ctx.db.query("vehicleReservations").withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject)).order("desc").take(100),
      ctx.db.query("vehicleReservations").withIndex("by_bookedForClerkId", (q) => q.eq("bookedForClerkId", identity.subject)).order("desc").take(100),
    ]);
    const byId = new Map<string, Doc<"vehicleReservations">>();
    for (const reservation of [...mine, ...forMe]) if (isActive(reservation, now)) byId.set(reservation._id, reservation);
    const trips = [...byId.values()].sort((a, b) => a.start - b.start);
    return await Promise.all(trips.map(async (reservation) => {
      const vehicle = await ctx.db.get(reservation.vehicleId);
      const shuttle = await ctx.db.query("mlShuttles").withIndex("by_vehicleReservationId", (q) => q.eq("vehicleReservationId", reservation._id)).first();
      const transits = shuttle
        ? (await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttle._id)).take(100)).filter((row) => row.status !== "annulee")
        : [];
      return {
        _id: reservation._id,
        vehicleName: vehicle?.name ?? "Véhicule",
        userName: reservation.userName,
        purpose: reservation.purpose,
        status: reservation.status,
        start: reservation.start,
        end: reservation.end,
        destination: reservation.destination ?? null,
        routeKm: reservation.routeKm ?? null,
        expectedKm: reservation.expectedKm ?? null,
        kmConfirmed: reservation.kmConfirmed ?? false,
        sitesOnRoute: reservation.sitesOnRoute ?? null,
        shuttle: shuttle ? { _id: shuttle._id, status: shuttleStatus(shuttle, transits) } : null,
        transits: await Promise.all(transits.map((row) => transitRow(ctx, row))),
      };
    }));
  },
});

/** Objets en attente de transit, pas encore pris par une navette. */
export const openTransits = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const rows = (await ctx.db.query("mlRequests").withIndex("by_status", (q) => q.eq("status", "a_preparer")).take(300)).filter((row) => !row.shuttleId);
    rows.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.createdAt - b.createdAt);
    return await Promise.all(rows.map((row) => transitRow(ctx, row)));
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

async function loadOwnTrip(ctx: MutationCtx, reservationId: Id<"vehicleReservations">, subject: string) {
  const reservation = await ctx.db.get(reservationId);
  if (!reservation || !isParticipant(reservation, subject)) throw new ConvexError("Réservation introuvable.");
  return reservation;
}

/** Ajoute ou corrige la destination d'un trajet, et/ou confirme son kilométrage. */
export const setTripDetails = mutation({
  args: {
    reservationId: v.id("vehicleReservations"),
    destination: v.optional(destinationValidator),
    routeKm: v.optional(v.number()),
    sitesOnRoute: v.optional(v.array(v.string())),
    /** Kilométrage confirmé ou corrigé par l'utilisateur (aller-retour). */
    expectedKm: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const reservation = await loadOwnTrip(ctx, args.reservationId, identity.subject);
    if (!isActive(reservation, Date.now())) throw new ConvexError("Cette réservation est terminée ou annulée.");
    const trip = cleanTrip(args);
    if (args.expectedKm !== undefined && (!Number.isFinite(args.expectedKm) || args.expectedKm < 0 || args.expectedKm > 20000)) {
      throw new ConvexError("Kilométrage invalide.");
    }
    const patch: Partial<Doc<"vehicleReservations">> = {};
    if (trip.destination) {
      patch.destination = trip.destination;
      patch.routeKm = trip.routeKm;
      patch.sitesOnRoute = trip.sitesOnRoute ?? [HOME_SITE];
      patch.kmConfirmed = false;
    }
    if (args.expectedKm !== undefined) {
      patch.expectedKm = Math.round(args.expectedKm);
      patch.kmConfirmed = true;
    }
    await ctx.db.patch(reservation._id, patch);
  },
});

async function logTransit(ctx: MutationCtx, requestId: Id<"mlRequests">, message: string, actor: string) {
  await ctx.db.insert("mlEvents", { requestId, message, actor, createdAt: Date.now() });
}

/** « Prendre le produit » : les objets choisis rejoignent la navette du conducteur. */
export const takeTransits = mutation({
  args: { reservationId: v.id("vehicleReservations"), requestIds: v.array(v.id("mlRequests")) },
  handler: async (ctx, { reservationId, requestIds }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    if (!requestIds.length || requestIds.length > 30) throw new ConvexError("Choisissez entre 1 et 30 objets.");
    const reservation = await loadOwnTrip(ctx, reservationId, identity.subject);
    if (!isActive(reservation, Date.now())) throw new ConvexError("Cette réservation est terminée ou annulée.");
    if (!reservation.destination || !reservation.sitesOnRoute) throw new ConvexError("Indiquez d'abord la destination de votre trajet.");
    const vehicle = await ctx.db.get(reservation.vehicleId);
    const scheduledDate = parisDay(reservation.start);
    const actor = reservation.userName;

    let shuttle = await ctx.db.query("mlShuttles").withIndex("by_vehicleReservationId", (q) => q.eq("vehicleReservationId", reservationId)).first();
    if (shuttle) {
      const current = (await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttle!._id)).take(100)).filter((row) => row.status !== "annulee");
      if (shuttleStatus(shuttle, current) !== "planifiee") throw new ConvexError("Votre navette est déjà partie : on ne peut plus y ajouter d'objets.");
    } else {
      const shuttleId = await ctx.db.insert("mlShuttles", {
        name: `${reservation.userName} → ${reservation.destination.label}`.slice(0, 100),
        scheduledDate,
        origin: LOCATIONS[HOME_SITE],
        destination: reservation.destination.label.slice(0, 300),
        vehicleReservationId: reservationId,
        driverName: reservation.userName,
        driverClerkId: reservation.bookedForClerkId ?? reservation.clerkId,
        vehicleName: vehicle?.name,
        createdAt: Date.now(),
      });
      shuttle = (await ctx.db.get(shuttleId))!;
    }

    const now = Date.now();
    for (const id of requestIds) {
      const row = await ctx.db.get(id);
      if (!row || row.status !== "a_preparer") throw new ConvexError("Un des objets n'est plus disponible. Actualisez la page.");
      if (row.shuttleId === shuttle._id) continue;
      if (row.shuttleId) throw new ConvexError(`L'objet ${row.reference} a déjà été pris par une autre navette.`);
      if (!transitOnRoute(row, reservation.sitesOnRoute)) throw new ConvexError(`« ${row.title} » n'est pas sur votre route.`);
      await ctx.db.patch(id, { shuttleId: shuttle._id, scheduledDate, prepared: true, assignee: actor, updatedAt: Math.max(now, row.updatedAt + 1) });
      await logTransit(ctx, id, `Pris par ${actor} sur son trajet du ${scheduledDate} (${vehicle?.name ?? "véhicule"} → ${reservation.destination.label})`, actor);
    }
    return shuttle._id;
  },
});

/** Repose un objet pris : il redevient disponible pour une autre navette. */
export const releaseTransit = mutation({
  args: { requestId: v.id("mlRequests") },
  handler: async (ctx, { requestId }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const row = await ctx.db.get(requestId);
    if (!row?.shuttleId) return;
    const shuttle = await ctx.db.get(row.shuttleId);
    if (!shuttle?.vehicleReservationId) throw new ConvexError("Cet objet n'est pas dans une de vos navettes.");
    const reservation = await loadOwnTrip(ctx, shuttle.vehicleReservationId, identity.subject);
    if (row.status !== "a_preparer") throw new ConvexError("Cet objet est déjà parti.");
    await detachTransit(ctx, row, `Reposé par ${reservation.userName} : de nouveau disponible`, reservation.userName);
    await deleteShuttleIfEmpty(ctx, shuttle._id);
  },
});

async function detachTransit(ctx: MutationCtx, row: Doc<"mlRequests">, message: string, actor: string) {
  await ctx.db.patch(row._id, { shuttleId: undefined, scheduledDate: undefined, prepared: false, assignee: undefined, loadedAt: undefined, loadedBy: undefined, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
  await logTransit(ctx, row._id, message, actor);
}

async function deleteShuttleIfEmpty(ctx: MutationCtx, shuttleId: Id<"mlShuttles">) {
  const remaining = await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttleId)).first();
  if (!remaining) await ctx.db.delete(shuttleId);
}

/**
 * Réservation annulée ou refusée : les objets pas encore partis redeviennent
 * disponibles, et la navette vide disparaît du calendrier Meslogistic.
 */
export async function releaseTripTransits(ctx: MutationCtx, reservationId: Id<"vehicleReservations">, reason: string) {
  const shuttle = await ctx.db.query("mlShuttles").withIndex("by_vehicleReservationId", (q) => q.eq("vehicleReservationId", reservationId)).first();
  if (!shuttle) return;
  const rows = await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttle._id)).take(100);
  for (const row of rows) {
    if (row.status === "a_preparer") await detachTransit(ctx, row, `Navette de ${shuttle.driverName ?? "?"} annulée (${reason}) : de nouveau disponible`, "Mes Outils");
  }
  await deleteShuttleIfEmpty(ctx, shuttle._id);
}
