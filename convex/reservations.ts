import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  clerkIdForEmail,
  emailForClerkId,
  hasCrmPermission,
  photoForClerkId,
  requireCrmPermission,
  requireUser,
} from "./lib";
import { vehicleBusyReason } from "./fleet";
import { createMesoutilsNotification } from "./mesoutilsNotifications";

/** Photo de profil de l'identité Clerk courante, si présente. */
function pictureUrl(identity: unknown): string | undefined {
  return (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined;
}

/** Args d'image d'un actif (véhicule/salle) pour les emails : proxy si stocké. */
function assetImageArgs(asset: { photo?: unknown; photoUrl?: string }) {
  return asset.photo
    ? { assetImageStorageId: String(asset.photo) }
    : asset.photoUrl
      ? { assetImageUrl: asset.photoUrl }
      : {};
}

const PAGE_KEY = "mesoutils:reservations";

// Destinataire unique des notifications « nouvelle demande de réservation
// véhicule » : seul ce compte est prévenu de chaque demande.
const VEHICLE_REQUEST_NOTIFY_EMAILS = [
  "f.henry@eco-solidaire.fr",
  "y.prata@eco-solidaire.fr",
];

function ensureRange(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error("Créneau invalide.");
  }
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

async function ensureVehicleAvailable(
  ctx: QueryCtx | MutationCtx,
  vehicleId: Id<"vehicles">,
  start: number,
  end: number,
) {
  const dayMs = 86_400_000;
  for (
    let cursor = Math.floor(start / dayMs) * dayMs;
    cursor < end;
    cursor += dayMs
  ) {
    const reason = await vehicleBusyReason(ctx, vehicleId, cursor);
    if (reason) throw new Error(reason);
  }
}

function displayName(identity: {
  name?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
}) {
  const fullName = [identity.givenName, identity.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return identity.name?.trim() || fullName || identity.email?.trim() || "Utilisateur";
}

function normalizeVehicleKind(kind: string) {
  return kind === "voiture" ? "voiture" : "utilitaire";
}

async function resolveVehiclePhotoUrls(
  ctx: QueryCtx | MutationCtx,
  vehicles: Doc<"vehicles">[],
) {
  return await Promise.all(
    vehicles.map(async (vehicle) => ({
      ...vehicle,
      kind: normalizeVehicleKind(vehicle.kind),
      photoUrl: vehicle.photo ? await ctx.storage.getUrl(vehicle.photo) : null,
    })),
  );
}

async function approvedReservationsForVehicle(
  ctx: QueryCtx | MutationCtx,
  vehicleId: Id<"vehicles">,
) {
  const reservations = await ctx.db
    .query("vehicleReservations")
    .withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicleId))
    .collect();
  return reservations.filter((reservation) => reservation.status === "approved");
}

export const listRooms = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const rooms = await ctx.db.query("rooms").order("asc").collect();
    return await Promise.all(
      rooms.map(async (room) => ({
        ...room,
        photoUrl: room.photo ? await ctx.storage.getUrl(room.photo) : room.photoUrl,
      })),
    );
  },
});

export const createRoom = mutation({
  args: {
    name: v.string(),
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    capacity: v.optional(v.number()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    return await ctx.db.insert("rooms", {
      ...args,
      active: true,
      createdAt: Date.now(),
    });
  },
});

export const updateRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    name: v.string(),
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    capacity: v.optional(v.number()),
    color: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, { roomId, ...patch }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    await ctx.db.patch(roomId, patch);
  },
});

export const listRoomReservations = query({
  args: {
    start: v.number(),
    end: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    ensureRange(args.start, args.end);
    const reservations = await ctx.db.query("roomReservations").collect();
    return reservations.filter((reservation) =>
      overlaps(reservation.start, reservation.end, args.start, args.end),
    );
  },
});

export const bookRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    title: v.string(),
    usageType: v.optional(v.string()),
    attendees: v.optional(v.number()),
    start: v.number(),
    end: v.number(),
    notes: v.optional(v.string()),
    forClerkId: v.optional(v.string()),
    forName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    ensureRange(args.start, args.end);
    const room = await ctx.db.get(args.roomId);
    if (!room || !room.active) throw new Error("Salle indisponible.");

    if (args.attendees !== undefined) {
      if (!Number.isFinite(args.attendees) || args.attendees < 1) {
        throw new Error("Nombre de personnes invalide.");
      }
      if (room.capacity && args.attendees > room.capacity) {
        throw new Error(`Cette salle accueille ${room.capacity} personnes maximum.`);
      }
    }

    const existing = await ctx.db
      .query("roomReservations")
      .withIndex("by_roomId", (q) => q.eq("roomId", args.roomId))
      .collect();
    const conflict = existing.find((reservation) =>
      overlaps(reservation.start, reservation.end, args.start, args.end),
    );
    if (conflict) {
      throw new Error("Ce créneau est déjà réservé pour cette salle.");
    }

    const onBehalf = args.forName?.trim();
    const reservationId = await ctx.db.insert("roomReservations", {
      roomId: args.roomId,
      clerkId: identity.subject,
      userName: onBehalf || displayName(identity),
      bookedByName: onBehalf ? displayName(identity) : undefined,
      bookedForClerkId: onBehalf ? args.forClerkId : undefined,
      title: args.title.trim(),
      usageType: args.usageType?.trim() || undefined,
      attendees: args.attendees,
      start: args.start,
      end: args.end,
      notes: args.notes?.trim() || undefined,
      createdAt: Date.now(),
    });
    await createMesoutilsNotification(ctx, {
      recipientClerkId: onBehalf ? args.forClerkId : identity.subject,
      kind: "room_reservation_confirmed",
      title: "Votre réservation de salle est confirmée",
      body: `${room.name} · ${args.title.trim()}`,
      assetImageUrl: (room.photo ? await ctx.storage.getUrl(room.photo) : room.photoUrl) ?? undefined,
      href: "/reservations?v=mine",
    });
    const requesterName = onBehalf || displayName(identity);
    const requesterPhotoUrl =
      (onBehalf ? await photoForClerkId(ctx, args.forClerkId) : pictureUrl(identity)) ??
      undefined;
    const roomImageUrl =
      (room.photo ? await ctx.storage.getUrl(room.photo) : room.photoUrl) ?? undefined;

    const email = onBehalf
      ? await emailForClerkId(ctx, args.forClerkId)
      : identity.email ?? await emailForClerkId(ctx, identity.subject);
    if (email) {
      await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendReservationEmail, {
        email,
        name: requesterName,
        assetKind: "room",
        assetName: room.name,
        label: args.title.trim(),
        start: args.start,
        end: args.end,
        state: "confirmed",
        photoUrl: requesterPhotoUrl,
        assetImageUrl: roomImageUrl,
      });
    }

    // Email aux responsables des réservations de salle (a.still & y.prata).
    // Décalé pour ne pas dépasser la limite Resend (2 req/s) avec l'email au demandeur.
    await ctx.scheduler.runAfter(1200, internal.mesoutilsEmails.sendRoomReservationToManagers, {
      requesterName,
      requesterPhotoUrl,
      roomName: room.name,
      roomImageUrl,
      label: args.title.trim(),
      start: args.start,
      end: args.end,
      note: args.notes?.trim() || undefined,
    });

    return reservationId;
  },
});

export const cancelRoomReservation = mutation({
  args: {
    reservationId: v.id("roomReservations"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) return;
    const isManager = await hasCrmPermission(ctx, PAGE_KEY, "manage");
    if (reservation.clerkId !== identity.subject && !isManager) {
      throw new Error("Annulation non autorisée.");
    }
    const room = await ctx.db.get(reservation.roomId);
    await ctx.db.delete(args.reservationId);
    const recipientClerkId = reservation.bookedForClerkId ?? reservation.clerkId;
    const email = await emailForClerkId(ctx, recipientClerkId);
    if (email) {
      await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendReservationEmail, {
        email,
        name: reservation.userName,
        assetKind: "room",
        assetName: room?.name ?? "Salle",
        label: reservation.title,
        start: reservation.start,
        end: reservation.end,
        state: "cancelled",
        photoUrl: (await photoForClerkId(ctx, recipientClerkId)) ?? undefined,
        ...(room ? assetImageArgs(room) : {}),
      });
    }
  },
});

async function isVehicleFree(
  ctx: QueryCtx | MutationCtx,
  vehicleId: Id<"vehicles">,
  start: number,
  end: number,
) {
  const dayMs = 86_400_000;
  for (let cursor = Math.floor(start / dayMs) * dayMs; cursor < end; cursor += dayMs) {
    if (await vehicleBusyReason(ctx, vehicleId, cursor)) return false;
  }
  return true;
}

export const availableRooms = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    ensureRange(args.start, args.end);
    const rooms = (await ctx.db.query("rooms").collect()).filter((room) => room.active);
    const reservations = await ctx.db.query("roomReservations").collect();
    const available = rooms.filter(
      (room) =>
        !reservations.some(
          (reservation) =>
            reservation.roomId === room._id && overlaps(reservation.start, reservation.end, args.start, args.end),
        ),
    );
    return await Promise.all(
      available.map(async (room) => ({
        ...room,
        photoUrl: room.photo ? await ctx.storage.getUrl(room.photo) : room.photoUrl,
      })),
    );
  },
});

/**
 * Toutes les salles actives avec leur état sur le créneau : libres, ou
 * occupées avec « réservé par X » (affichage grisé côté UI, sans bouton).
 */
export const listRoomsForSlot = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    ensureRange(args.start, args.end);
    const rooms = (await ctx.db.query("rooms").collect()).filter((room) => room.active);
    const reservations = await ctx.db.query("roomReservations").collect();
    return await Promise.all(
      rooms.map(async (room) => {
        const conflict = reservations
          .filter(
            (reservation) =>
              reservation.roomId === room._id &&
              overlaps(reservation.start, reservation.end, args.start, args.end),
          )
          .sort((a, b) => a.start - b.start)[0];
        return {
          ...room,
          photoUrl: room.photo ? await ctx.storage.getUrl(room.photo) : room.photoUrl,
          occupiedBy: conflict
            ? { userName: conflict.userName, start: conflict.start, end: conflict.end }
            : null,
        };
      }),
    );
  },
});

/** Tous les véhicules actifs avec leur état sur le créneau (voir listRoomsForSlot). */
export const listVehiclesForSlot = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    ensureRange(args.start, args.end);
    const vehicles = (await ctx.db.query("vehicles").collect()).filter(
      (vehicle) => vehicle.active,
    );
    const withPhotos = await resolveVehiclePhotoUrls(ctx, vehicles);
    return await Promise.all(
      withPhotos.map(async (vehicle) => {
        const approved = await approvedReservationsForVehicle(ctx, vehicle._id);
        const conflict = approved
          .filter((reservation) => overlaps(reservation.start, reservation.end, args.start, args.end))
          .sort((a, b) => a.start - b.start)[0];
        let unavailableReason: string | null = null;
        if (!conflict && !(await isVehicleFree(ctx, vehicle._id, args.start, args.end))) {
          unavailableReason = "Indisponible sur ce créneau";
        }
        return {
          ...vehicle,
          occupiedBy: conflict
            ? { userName: conflict.userName, start: conflict.start, end: conflict.end }
            : null,
          unavailableReason,
        };
      }),
    );
  },
});

export const availableVehicles = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    ensureRange(args.start, args.end);
    const vehicles = (await ctx.db.query("vehicles").collect()).filter((vehicle) => vehicle.active);
    const free: Doc<"vehicles">[] = [];
    for (const vehicle of vehicles) {
      if (await isVehicleFree(ctx, vehicle._id, args.start, args.end)) free.push(vehicle);
    }
    return await resolveVehiclePhotoUrls(ctx, free);
  },
});

/** Réservations véhicules (approuvées + en attente) sur une plage, pour l'agenda. */
export const listVehicleBookings = query({
  args: { start: v.number(), end: v.number() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const reservations = await ctx.db.query("vehicleReservations").collect();
    const vehicles = await ctx.db.query("vehicles").collect();
    const nameById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle.name]));
    return reservations
      .filter((reservation) => reservation.status !== "rejected" && overlaps(reservation.start, reservation.end, args.start, args.end))
      .map((reservation) => ({
        _id: reservation._id,
        vehicleName: nameById.get(String(reservation.vehicleId)) ?? "Véhicule",
        clerkId: reservation.clerkId,
        userName: reservation.userName,
        purpose: reservation.purpose,
        usageType: reservation.usageType,
        expectedKm: reservation.expectedKm,
        start: reservation.start,
        end: reservation.end,
        status: reservation.status,
      }))
      .sort((a, b) => a.start - b.start);
  },
});

/** Toutes les réservations de l'utilisateur courant (salles + véhicules). */
export const listMyReservations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const me = identity.subject;

    const [roomRes, vehicleRes, rooms, vehicles] = await Promise.all([
      ctx.db.query("roomReservations").collect(),
      ctx.db.query("vehicleReservations").collect(),
      ctx.db.query("rooms").collect(),
      ctx.db.query("vehicles").collect(),
    ]);
    const roomName = new Map(rooms.map((room) => [String(room._id), room.name]));
    const vehicleName = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle.name]));

    const mine = [
      ...roomRes
        .filter((reservation) => reservation.clerkId === me || reservation.bookedForClerkId === me)
        .map((reservation) => ({
          _id: String(reservation._id),
          kind: "room" as const,
          assetName: roomName.get(String(reservation.roomId)) ?? "Salle",
          label: reservation.title,
          start: reservation.start,
          end: reservation.end,
          status: "confirmed" as const,
        })),
      ...vehicleRes
        .filter((reservation) => reservation.clerkId === me || reservation.bookedForClerkId === me)
        .map((reservation) => ({
          _id: String(reservation._id),
          kind: "vehicle" as const,
          assetName: vehicleName.get(String(reservation.vehicleId)) ?? "Véhicule",
          label: reservation.purpose,
          start: reservation.start,
          end: reservation.end,
          status: reservation.status,
        })),
    ];
    return mine.sort((a, b) => b.start - a.start);
  },
});

export const listVehicles = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const vehicles = (await ctx.db.query("vehicles").collect()).filter(
      (vehicle) => vehicle.active,
    );
    return await resolveVehiclePhotoUrls(ctx, vehicles);
  },
});

export const listVehicleReservations = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    ),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const canManage = await hasCrmPermission(ctx, PAGE_KEY, "manage");
    const reservations = await ctx.db
      .query("vehicleReservations")
      .order("desc")
      .take(200);
    const filtered = reservations.filter((reservation) => {
      if (args.status && reservation.status !== args.status) return false;
      if (canManage) return true;
      return reservation.clerkId === identity.subject;
    });
    const vehicles = await ctx.db.query("vehicles").collect();
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));

    return await Promise.all(
      filtered.map(async (reservation) => {
        const vehicle = vehicleById.get(String(reservation.vehicleId)) ?? null;
        return {
          ...reservation,
          vehicle,
          vehiclePhotoUrl:
            vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : null,
        };
      }),
    );
  },
});

export const pendingVehicleReservationsCount = query({
  args: {},
  handler: async (ctx) => {
    try {
      await requireCrmPermission(ctx, PAGE_KEY, "manage");
    } catch {
      return 0;
    }
    const pending = await ctx.db
      .query("vehicleReservations")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return pending.length;
  },
});

export const requestVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    purpose: v.string(),
    usageType: v.optional(v.union(v.literal("pro"), v.literal("personal"))),
    expectedKm: v.optional(v.number()),
    willTransport: v.optional(v.boolean()),
    transportDetails: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    forClerkId: v.optional(v.string()),
    forName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    ensureRange(args.start, args.end);
    const vehicle = await ctx.db.get(args.vehicleId);
    if (!vehicle || !vehicle.active) throw new Error("Véhicule indisponible.");

    if (args.usageType === "pro" && vehicle.reservablePro === false) {
      throw new Error("Ce véhicule n'est pas réservable pour un usage professionnel.");
    }
    if (args.usageType === "personal" && vehicle.reservablePersonal !== true) {
      throw new Error("Ce véhicule n'est pas réservable pour un usage personnel.");
    }
    if (args.expectedKm !== undefined && (!Number.isFinite(args.expectedKm) || args.expectedKm < 0)) {
      throw new Error("Kilométrage estimé invalide.");
    }

    await ensureVehicleAvailable(ctx, args.vehicleId, args.start, args.end);

    const approvedReservations = await approvedReservationsForVehicle(ctx, args.vehicleId);
    const conflict = approvedReservations.find((reservation) =>
      overlaps(reservation.start, reservation.end, args.start, args.end),
    );
    if (conflict) {
      throw new Error("Ce véhicule est déjà réservé sur ce créneau.");
    }

    const onBehalf = args.forName?.trim();
    const willTransport = args.willTransport ?? false;
    const transportDetails = willTransport
      ? args.transportDetails?.trim() || undefined
      : undefined;
    const reservationId = await ctx.db.insert("vehicleReservations", {
      vehicleId: args.vehicleId,
      clerkId: identity.subject,
      userName: onBehalf || displayName(identity),
      bookedByName: onBehalf ? displayName(identity) : undefined,
      bookedForClerkId: onBehalf ? args.forClerkId : undefined,
      purpose: args.purpose.trim(),
      usageType: args.usageType,
      expectedKm: args.expectedKm,
      willTransport,
      transportDetails,
      start: args.start,
      end: args.end,
      status: "pending",
      createdAt: Date.now(),
    });

    // Les responsables sont notifiés de chaque demande de réservation véhicule :
    // notification in-app (pour ceux qui ont un compte) + email systématique.
    const requesterName = onBehalf || displayName(identity);
    const requesterPhotoUrl =
      (onBehalf ? await photoForClerkId(ctx, args.forClerkId) : pictureUrl(identity)) ??
      undefined;
    const assetImageUrl =
      (vehicle.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle.photoUrl) ?? undefined;
    for (const managerEmail of VEHICLE_REQUEST_NOTIFY_EMAILS) {
      const notifyClerkId = await clerkIdForEmail(ctx, managerEmail);
      if (notifyClerkId && notifyClerkId !== identity.subject) {
        await createMesoutilsNotification(ctx, {
          recipientClerkId: notifyClerkId,
          kind: "vehicle_reservation_request",
          title: "Nouvelle demande de réservation de véhicule",
          body: [vehicle.name, requesterName, args.purpose.trim()]
            .filter(Boolean)
            .join(" · "),
          actorName: displayName(identity),
          assetImageUrl,
          href: "/gotravaux?v=reservations",
        });
      }
    }

    // Email aux responsables (adresses fixes), qu'ils aient un compte ou non.
    await ctx.scheduler.runAfter(1200, internal.mesoutilsEmails.sendVehicleRequestToManagers, {
      requesterName,
      requesterPhotoUrl,
      vehicleName: vehicle.name,
      vehicleImageUrl: assetImageUrl,
      label: args.purpose.trim(),
      start: args.start,
      end: args.end,
    });

    // Véhicule mis à disposition de la Recyclerie : on prévient son équipe.
    if (vehicle.recycappEnabled === true) {
      await ctx.scheduler.runAfter(2400, internal.mesoutilsEmails.sendRecyclerieVehicleNotice, {
        state: "submitted",
        requesterName,
        requesterPhotoUrl,
        vehicleName: vehicle.name,
        vehicleImageUrl: assetImageUrl,
        label: args.purpose.trim(),
        start: args.start,
        end: args.end,
      });
    }

    const email = onBehalf
      ? await emailForClerkId(ctx, args.forClerkId)
      : identity.email ?? null;
    if (email) {
      await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendReservationEmail, {
        email,
        name: onBehalf || displayName(identity),
        assetKind: "vehicle",
        assetName: vehicle.name,
        label: args.purpose.trim(),
        start: args.start,
        end: args.end,
        state: "submitted",
        photoUrl: requesterPhotoUrl,
        assetImageUrl,
      });
    }
    return reservationId;
  },
});

/**
 * Applique une décision (accepter/refuser) sur une réservation véhicule :
 * contrôle de disponibilité, notification + emails au demandeur, et notice
 * Recyclerie le cas échéant. Partagé entre la décision Mes Outils (Gotravaux)
 * et la décision côté Recyclerie (recycapp).
 */
async function applyVehicleReservationDecision(
  ctx: MutationCtx,
  identity: Awaited<ReturnType<typeof requireUser>>,
  args: {
    reservationId: Id<"vehicleReservations">;
    decision: "approved" | "rejected";
    note?: string;
  },
  opts: { requireRecyclerie?: boolean } = {},
) {
  const reservation = await ctx.db.get(args.reservationId);
  if (!reservation) throw new Error("Réservation introuvable.");
  const vehicle = await ctx.db.get(reservation.vehicleId);
  if (opts.requireRecyclerie && vehicle?.recycappEnabled !== true) {
    throw new Error("Ce véhicule n'est pas rattaché à la Recyclerie.");
  }

  if (args.decision === "approved") {
    await ensureVehicleAvailable(ctx, reservation.vehicleId, reservation.start, reservation.end);
    const approvedReservations = await approvedReservationsForVehicle(ctx, reservation.vehicleId);
    const conflict = approvedReservations.find(
      (item) =>
        item._id !== reservation._id &&
        overlaps(item.start, item.end, reservation.start, reservation.end),
    );
    if (conflict) throw new Error("Le véhicule est déjà réservé sur ce créneau.");
  }

  await ctx.db.patch(args.reservationId, {
    status: args.decision,
    decisionNote: args.note?.trim() || undefined,
    decidedBy: displayName(identity),
    decidedAt: Date.now(),
  });

  await createMesoutilsNotification(ctx, {
    recipientClerkId: reservation.bookedForClerkId ?? reservation.clerkId,
    kind: "vehicle_reservation_decided",
    title:
      args.decision === "approved"
        ? "Votre réservation de véhicule est approuvée"
        : "Votre réservation de véhicule est refusée",
    body: [vehicle?.name ?? "Véhicule", reservation.purpose, args.note?.trim()]
      .filter(Boolean)
      .join(" · "),
    actorName: displayName(identity),
    assetImageUrl: (vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : undefined) ?? undefined,
    href: "/reservations?v=mine",
  });

  const recipientClerkId = reservation.bookedForClerkId ?? reservation.clerkId;
  const requesterPhotoUrl = (await photoForClerkId(ctx, recipientClerkId)) ?? undefined;
  const vehicleImageUrl =
    (vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle?.photoUrl) ?? undefined;
  const email = await emailForClerkId(ctx, recipientClerkId);
  if (email) {
    await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendReservationEmail, {
      email,
      name: reservation.userName,
      assetKind: "vehicle",
      assetName: vehicle?.name ?? "Véhicule",
      label: reservation.purpose,
      start: reservation.start,
      end: reservation.end,
      state: args.decision === "approved" ? "approved" : "rejected",
      note: args.note?.trim() || undefined,
      photoUrl: requesterPhotoUrl,
      assetImageUrl: vehicleImageUrl,
    });
  }

  // Véhicule Recyclerie accepté : on prévient l'équipe (sans lien Gotravaux).
  if (args.decision === "approved" && vehicle?.recycappEnabled === true) {
    await ctx.scheduler.runAfter(1200, internal.mesoutilsEmails.sendRecyclerieVehicleNotice, {
      state: "approved",
      requesterName: reservation.userName,
      requesterPhotoUrl,
      vehicleName: vehicle.name,
      vehicleImageUrl,
      label: reservation.purpose,
      start: reservation.start,
      end: reservation.end,
      note: args.note?.trim() || undefined,
    });
  }
}

export const decideVehicleReservation = mutation({
  args: {
    reservationId: v.id("vehicleReservations"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    const identity = await requireUser(ctx);
    await applyVehicleReservationDecision(ctx, identity, args);
  },
});

/**
 * Décision côté Recyclerie (recycapp) : réservée aux véhicules mis à disposition
 * de la Recyclerie, protégée par le droit `flotte` (manage).
 */
export const decideRecyclerieVehicleReservation = mutation({
  args: {
    reservationId: v.id("vehicleReservations"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "reservations", "manage");
    const identity = await requireUser(ctx);
    await applyVehicleReservationDecision(ctx, identity, args, { requireRecyclerie: true });
  },
});

/**
 * Réservations des véhicules mis à disposition de la Recyclerie, pour la page
 * « Réservations » de recycapp. Protégée par le droit `flotte` (lecture).
 */
export const listRecyclerieVehicleReservations = query({
  args: {
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    ),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "reservations", "read");
    const vehicles = await ctx.db.query("vehicles").collect();
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));

    const reservations = await ctx.db
      .query("vehicleReservations")
      .order("desc")
      .take(200);
    const filtered = reservations.filter((reservation) => {
      if (args.status && reservation.status !== args.status) return false;
      return vehicleById.get(String(reservation.vehicleId))?.recycappEnabled === true;
    });

    return await Promise.all(
      filtered.map(async (reservation) => {
        const vehicle = vehicleById.get(String(reservation.vehicleId)) ?? null;
        return {
          ...reservation,
          vehicle,
          vehiclePhotoUrl: vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : null,
        };
      }),
    );
  },
});

/** Annulation d'une réservation véhicule Recyclerie (droit `flotte` manage). */
export const cancelRecyclerieVehicleReservation = mutation({
  args: { reservationId: v.id("vehicleReservations") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "reservations", "manage");
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) return;
    const vehicle = await ctx.db.get(reservation.vehicleId);
    if (vehicle?.recycappEnabled !== true) {
      throw new Error("Ce véhicule n'est pas rattaché à la Recyclerie.");
    }
    await ctx.db.delete(args.reservationId);
    const recipientClerkId = reservation.bookedForClerkId ?? reservation.clerkId;
    const email = await emailForClerkId(ctx, recipientClerkId);
    if (email) {
      await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendReservationEmail, {
        email,
        name: reservation.userName,
        assetKind: "vehicle",
        assetName: vehicle?.name ?? "Véhicule",
        label: reservation.purpose,
        start: reservation.start,
        end: reservation.end,
        state: "cancelled",
        photoUrl: (await photoForClerkId(ctx, recipientClerkId)) ?? undefined,
        assetImageUrl:
          (vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle?.photoUrl) ??
          undefined,
      });
    }
  },
});

export const cancelVehicleReservation = mutation({
  args: {
    reservationId: v.id("vehicleReservations"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) return;
    const canManage = await hasCrmPermission(ctx, PAGE_KEY, "manage");
    if (reservation.clerkId !== identity.subject && !canManage) {
      throw new Error("Annulation non autorisée.");
    }
    const vehicle = await ctx.db.get(reservation.vehicleId);
    await ctx.db.delete(args.reservationId);
    const recipientClerkId = reservation.bookedForClerkId ?? reservation.clerkId;
    const email = await emailForClerkId(ctx, recipientClerkId);
    if (email) {
      await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendReservationEmail, {
        email,
        name: reservation.userName,
        assetKind: "vehicle",
        assetName: vehicle?.name ?? "Véhicule",
        label: reservation.purpose,
        start: reservation.start,
        end: reservation.end,
        state: "cancelled",
        photoUrl: (await photoForClerkId(ctx, recipientClerkId)) ?? undefined,
        assetImageUrl:
          (vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle?.photoUrl) ??
          undefined,
      });
    }
  },
});
