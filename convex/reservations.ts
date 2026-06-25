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

async function resolveVehiclePhotoUrls(
  ctx: QueryCtx | MutationCtx,
  vehicles: Doc<"vehicles">[],
) {
  return await Promise.all(
    vehicles.map(async (vehicle) => ({
      ...vehicle,
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
    return await ctx.db.query("rooms").order("asc").collect();
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

    return await ctx.db.insert("roomReservations", {
      roomId: args.roomId,
      clerkId: identity.subject,
      userName: displayName(identity),
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

    return await ctx.db.insert("vehicleReservations", {
      vehicleId: args.vehicleId,
      clerkId: identity.subject,
      userName: displayName(identity),
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
