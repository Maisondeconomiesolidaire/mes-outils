import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCrmPermission, requireUser } from "./lib";
import { vehicleBusyReason } from "./fleet";

const PAGE_KEY = "mesoutils:reservations";

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
    return await ctx.db.insert("roomReservations", {
      roomId: args.roomId,
      clerkId: identity.subject,
      userName: onBehalf || displayName(identity),
      bookedByName: onBehalf ? displayName(identity) : undefined,
      bookedForClerkId: onBehalf ? args.forClerkId : undefined,
      title: args.title.trim(),
      start: args.start,
      end: args.end,
      notes: args.notes?.trim() || undefined,
      createdAt: Date.now(),
    });
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
    const isManager = await (async () => {
      try {
        await requireCrmPermission(ctx, PAGE_KEY, "manage");
        return true;
      } catch {
        return false;
      }
    })();
    if (reservation.clerkId !== identity.subject && !isManager) {
      throw new Error("Annulation non autorisée.");
    }
    await ctx.db.delete(args.reservationId);
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
        userName: reservation.userName,
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
    const canManage = await (async () => {
      try {
        await requireCrmPermission(ctx, PAGE_KEY, "manage");
        return true;
      } catch {
        return false;
      }
    })();
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

export const requestVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    purpose: v.string(),
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

    await ensureVehicleAvailable(ctx, args.vehicleId, args.start, args.end);

    const approvedReservations = await approvedReservationsForVehicle(ctx, args.vehicleId);
    const conflict = approvedReservations.find((reservation) =>
      overlaps(reservation.start, reservation.end, args.start, args.end),
    );
    if (conflict) {
      throw new Error("Ce véhicule est déjà réservé sur ce créneau.");
    }

    const onBehalf = args.forName?.trim();
    return await ctx.db.insert("vehicleReservations", {
      vehicleId: args.vehicleId,
      clerkId: identity.subject,
      userName: onBehalf || displayName(identity),
      bookedByName: onBehalf ? displayName(identity) : undefined,
      bookedForClerkId: onBehalf ? args.forClerkId : undefined,
      purpose: args.purpose.trim(),
      start: args.start,
      end: args.end,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const decideVehicleReservation = mutation({
  args: {
    reservationId: v.id("vehicleReservations"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    const identity = await requireUser(ctx);
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation) throw new Error("Réservation introuvable.");

    if (args.decision === "approved") {
      await ensureVehicleAvailable(
        ctx,
        reservation.vehicleId,
        reservation.start,
        reservation.end,
      );

      const approvedReservations = await approvedReservationsForVehicle(
        ctx,
        reservation.vehicleId,
      );
      const conflict = approvedReservations.find(
        (item) =>
          item._id !== reservation._id &&
          overlaps(item.start, item.end, reservation.start, reservation.end),
      );
      if (conflict) {
        throw new Error("Le véhicule est déjà réservé sur ce créneau.");
      }
    }

    await ctx.db.patch(args.reservationId, {
      status: args.decision,
      decisionNote: args.note?.trim() || undefined,
      decidedBy: displayName(identity),
      decidedAt: Date.now(),
    });
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
    const canManage = await (async () => {
      try {
        await requireCrmPermission(ctx, PAGE_KEY, "manage");
        return true;
      } catch {
        return false;
      }
    })();
    if (reservation.clerkId !== identity.subject && !canManage) {
      throw new Error("Annulation non autorisée.");
    }
    await ctx.db.delete(args.reservationId);
  },
});
