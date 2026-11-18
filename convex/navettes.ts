/**
 * Page « Navettes » de Mes Outils.
 *
 * Quand un salarié réserve un véhicule, il indique sa destination. Son trajet
 * part toujours du Solidarium (Lachapelle-aux-Pots) et y revient ; on note
 * quels sites logistiques (Comptoir C à Beauvais, Esspace 150 à Gournay) sont
 * sur sa route. Le trajet apparaît aussitôt comme navette à son nom dans le
 * calendrier Meslogistic. L'équipe logistique peut y ajouter des objets : ils
 * lui sont PROPOSÉS, et il les accepte ou les refuse depuis la page Navettes.
 */
import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCrmPermission, requireUser } from "./lib";
import { materialPhoto } from "./meslogistic";
import { canonicalLocation, LOCATIONS, SHORT_LOCATION_NAMES } from "./meslogisticRules";
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
} from "./lib/navettesRoute";

const PAGE_KEY = "mesoutils:navettes";
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

async function activeTripsOf(ctx: QueryCtx, subject: string) {
  const now = Date.now();
  const [mine, forMe] = await Promise.all([
    ctx.db.query("vehicleReservations").withIndex("by_clerkId", (q) => q.eq("clerkId", subject)).order("desc").take(100),
    ctx.db.query("vehicleReservations").withIndex("by_bookedForClerkId", (q) => q.eq("bookedForClerkId", subject)).order("desc").take(100),
  ]);
  const byId = new Map<string, Doc<"vehicleReservations">>();
  for (const reservation of [...mine, ...forMe]) {
    if (byId.has(reservation._id)) continue;
    // Trajet à venir ou en cours, ou trajet passé dont des objets attendent
    // encore la confirmation de réception du conducteur.
    if (isActive(reservation, now) || (reservation.status === "approved" && (await awaitsReception(ctx, reservation._id)))) {
      byId.set(reservation._id, reservation);
    }
  }
  return [...byId.values()].sort((a, b) => a.start - b.start);
}

async function awaitsReception(ctx: QueryCtx, reservationId: Id<"vehicleReservations">) {
  const shuttle = await tripShuttle(ctx, reservationId);
  if (!shuttle) return false;
  return (await liveTransits(ctx, shuttle._id)).some((row) => row.status === "en_transit");
}

async function tripShuttle(ctx: QueryCtx, reservationId: Id<"vehicleReservations">) {
  return await ctx.db.query("mlShuttles").withIndex("by_vehicleReservationId", (q) => q.eq("vehicleReservationId", reservationId)).first();
}

async function liveTransits(ctx: QueryCtx, shuttleId: Id<"mlShuttles">) {
  return (await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttleId)).take(100)).filter((row) => row.status !== "annulee");
}

/** Mes trajets à venir et les objets que Meslogistic m'a proposés / que j'ai acceptés. */
export const myTrips = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const trips = await activeTripsOf(ctx, identity.subject);
    return await Promise.all(trips.map(async (reservation) => {
      const vehicle = await ctx.db.get(reservation.vehicleId);
      const shuttle = await tripShuttle(ctx, reservation._id);
      // Objets pas encore proposés (« à confirmer » côté logistique) : invisibles.
      const transits = shuttle ? (await liveTransits(ctx, shuttle._id)).filter((row) => row.driverDecision !== "a_confirmer") : [];
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
        transits: await Promise.all(transits.map(async (row) => ({
          ...(await transitRow(ctx, row)),
          // Absent : objet pris par le conducteur lui-même (ancien fonctionnement).
          driverDecision: row.driverDecision ?? "acceptee",
        }))),
      };
    }));
  },
});

/**
 * Badge du menu : objets proposés auxquels je n'ai pas répondu, plus objets
 * transportés dont je dois confirmer la réception.
 */
export const pendingProposalsCount = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;
    let count = 0;
    for (const reservation of await activeTripsOf(ctx, identity.subject)) {
      const shuttle = await tripShuttle(ctx, reservation._id);
      if (!shuttle) continue;
      const transits = await liveTransits(ctx, shuttle._id);
      const planned = shuttleStatus(shuttle, transits) === "planifiee";
      count += transits.filter((row) => (planned && row.status === "a_preparer" && row.driverDecision === "proposee") || row.status === "en_transit").length;
    }
    return count;
  },
});

// ─── Navette Meslogistic du trajet ────────────────────────────────────────────

/**
 * Chaque trajet avec une destination a sa navette dans le calendrier
 * Meslogistic, au nom du conducteur, même vide : l'équipe logistique peut
 * alors lui proposer des objets. Met à jour nom, date et destination tant
 * que la navette n'est pas partie.
 */
export async function syncTripShuttle(ctx: MutationCtx, reservationId: Id<"vehicleReservations">) {
  const reservation = await ctx.db.get(reservationId);
  if (!reservation?.destination || !isActive(reservation, Date.now())) return null;
  const vehicle = await ctx.db.get(reservation.vehicleId);
  const fields = {
    // Départ → destination (le conducteur est affiché à part).
    name: `${SHORT_LOCATION_NAMES[HOME_SITE as keyof typeof SHORT_LOCATION_NAMES] ?? "Départ"} → ${reservation.destination.label}`.slice(0, 100),
    scheduledDate: parisDay(reservation.start),
    origin: LOCATIONS[HOME_SITE],
    destination: reservation.destination.label.slice(0, 300),
    driverName: reservation.userName,
    driverClerkId: reservation.bookedForClerkId ?? reservation.clerkId,
    vehicleName: vehicle?.name,
  };
  const shuttle = await tripShuttle(ctx, reservationId);
  if (!shuttle) return await ctx.db.insert("mlShuttles", { ...fields, vehicleReservationId: reservationId, createdAt: Date.now() });
  const transits = await liveTransits(ctx, shuttle._id);
  if (shuttleStatus(shuttle, transits) !== "planifiee") return shuttle._id;
  await ctx.db.patch(shuttle._id, fields);
  const now = Date.now();
  for (const row of transits) {
    if (row.scheduledDate !== fields.scheduledDate) await ctx.db.patch(row._id, { scheduledDate: fields.scheduledDate, updatedAt: Math.max(now, row.updatedAt + 1) });
  }
  return shuttle._id;
}

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
      patch.expectedKm = trip.routeKm;
      patch.kmConfirmed = false;
    }
    if (args.expectedKm !== undefined) {
      patch.expectedKm = Math.round(args.expectedKm);
      patch.kmConfirmed = true;
    }
    await ctx.db.patch(reservation._id, patch);
    if (trip.destination) await syncTripShuttle(ctx, reservation._id);
  },
});

async function logTransit(ctx: MutationCtx, requestId: Id<"mlRequests">, message: string, actor: string) {
  await ctx.db.insert("mlEvents", { requestId, message, actor, createdAt: Date.now() });
}

/**
 * Réponse du conducteur à un objet proposé par Meslogistic : il l'accepte, ou
 * le refuse (l'objet retourne « À planifier »). Un objet accepté peut encore
 * être rendu tant que la navette n'est pas partie.
 */
export const respondToTransit = mutation({
  args: { requestId: v.id("mlRequests"), accept: v.boolean() },
  handler: async (ctx, { requestId, accept }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const row = await ctx.db.get(requestId);
    if (!row?.shuttleId) throw new ConvexError("Cet objet n'est plus proposé sur votre trajet.");
    const shuttle = await ctx.db.get(row.shuttleId);
    if (!shuttle?.vehicleReservationId) throw new ConvexError("Cet objet n'est pas sur un de vos trajets.");
    const reservation = await loadOwnTrip(ctx, shuttle.vehicleReservationId, identity.subject);
    if (row.status !== "a_preparer" || shuttleStatus(shuttle, await liveTransits(ctx, shuttle._id)) !== "planifiee") {
      throw new ConvexError("Votre navette est déjà partie.");
    }
    if (row.driverDecision === "a_confirmer") throw new ConvexError("Cet objet ne vous a pas encore été proposé.");
    const actor = reservation.userName;
    if (accept) {
      if (row.driverDecision === "acceptee") return;
      await ctx.db.patch(row._id, { driverDecision: "acceptee", assignee: actor, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
      await logTransit(ctx, row._id, `Accepté par ${actor} sur son trajet du ${shuttle.scheduledDate}`, actor);
    } else {
      await detachTransit(ctx, row, `Refusé par ${actor} (trajet du ${shuttle.scheduledDate}) : à replanifier`, actor);
    }
  },
});

async function detachTransit(ctx: MutationCtx, row: Doc<"mlRequests">, message: string, actor: string) {
  await ctx.db.patch(row._id, { shuttleId: undefined, scheduledDate: undefined, prepared: false, assignee: undefined, driverDecision: undefined, loadedAt: undefined, loadedBy: undefined, updatedAt: Math.max(Date.now(), row.updatedAt + 1) });
  await logTransit(ctx, row._id, message, actor);
}

/**
 * Réservation annulée ou refusée : les objets pas encore partis redeviennent
 * disponibles, et la navette disparaît du calendrier Meslogistic.
 */
export async function releaseTripTransits(ctx: MutationCtx, reservationId: Id<"vehicleReservations">, reason: string) {
  const shuttle = await tripShuttle(ctx, reservationId);
  if (!shuttle) return;
  const rows = await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttle._id)).take(100);
  for (const row of rows) {
    if (row.status === "a_preparer") await detachTransit(ctx, row, `Trajet de ${shuttle.driverName ?? "?"} annulé (${reason}) : à replanifier`, "Mes Outils");
  }
  const remaining = await ctx.db.query("mlRequests").withIndex("by_shuttleId", (q) => q.eq("shuttleId", shuttle._id)).first();
  if (!remaining) await ctx.db.delete(shuttle._id);
}

// ─── Cycle de vie automatique : départ au début de la réservation, arrivée au retour ───

/**
 * Le trajet commence : la navette part. Les objets acceptés passent « en
 * transit » ; ceux encore en attente de réponse retournent « À planifier ».
 */
async function departTripShuttle(ctx: MutationCtx, shuttle: Doc<"mlShuttles">, actor: string) {
  const transits = await liveTransits(ctx, shuttle._id);
  if (shuttleStatus(shuttle, transits) !== "planifiee") return;
  const now = Date.now();
  for (const row of transits.filter((item) => item.status === "a_preparer")) {
    if (row.driverDecision === "proposee" || row.driverDecision === "a_confirmer") {
      await detachTransit(ctx, row, `Sans réponse de ${shuttle.driverName ?? "?"} au départ de son trajet : à replanifier`, actor);
      continue;
    }
    await ctx.db.patch(row._id, { status: "en_transit", prepared: true, loadedAt: row.loadedAt ?? now, loadedBy: row.loadedBy ?? shuttle.driverName, updatedAt: Math.max(now, row.updatedAt + 1) });
    await logTransit(ctx, row._id, `En transit · départ du trajet de ${shuttle.driverName ?? "?"} (« ${shuttle.name} »)`, actor);
  }
  await ctx.db.patch(shuttle._id, { status: "en_route", departedAt: now });
}

/** Toutes les 5 minutes : les trajets approuvés dont l'heure de début est passée partent. */
export const departStartedTrips = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const started = await ctx.db
      .query("vehicleReservations")
      .withIndex("by_start", (q) => q.gt("start", now - 7 * 24 * 3600 * 1000).lte("start", now))
      .take(500);
    for (const reservation of started) {
      if (reservation.status !== "approved" || reservation.feedbackSubmittedAt) continue;
      const shuttle = await tripShuttle(ctx, reservation._id);
      if (shuttle) await departTripShuttle(ctx, shuttle, "Mes Outils");
    }
  },
});

/**
 * Retour du véhicule effectué : la navette est terminée. Les objets restent
 * « en transit » tant que le conducteur n'a pas confirmé leur réception
 * (page Navettes) : une navette peut être terminée sans objets livrés.
 */
export async function completeTripShuttle(ctx: MutationCtx, reservationId: Id<"vehicleReservations">, actor: string) {
  let shuttle = await tripShuttle(ctx, reservationId);
  if (!shuttle) return;
  await departTripShuttle(ctx, shuttle, actor);
  shuttle = (await ctx.db.get(shuttle._id))!;
  const transits = await liveTransits(ctx, shuttle._id);
  if (shuttleStatus(shuttle, transits) === "terminee") return;
  await ctx.db.patch(shuttle._id, { status: "terminee", completedAt: Date.now() });
}

/** « Je confirme la réception » : le conducteur valide la livraison d'un objet transporté. */
export const confirmReception = mutation({
  args: { requestId: v.id("mlRequests") },
  handler: async (ctx, { requestId }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const row = await ctx.db.get(requestId);
    if (!row?.shuttleId) throw new ConvexError("Objet introuvable.");
    const shuttle = await ctx.db.get(row.shuttleId);
    if (!shuttle?.vehicleReservationId) throw new ConvexError("Cet objet n'est pas sur un de vos trajets.");
    const reservation = await loadOwnTrip(ctx, shuttle.vehicleReservationId, identity.subject);
    if (row.status === "receptionnee") return;
    if (row.status !== "en_transit") throw new ConvexError("Cet objet n'est pas encore parti.");
    const now = Date.now();
    await ctx.db.patch(row._id, { status: "receptionnee", receivedQuantity: row.quantity, receivedAt: now, updatedAt: Math.max(now, row.updatedAt + 1) });
    await logTransit(ctx, row._id, `Réception confirmée par ${reservation.userName} (« ${shuttle.name} »)`, reservation.userName);
  },
});
