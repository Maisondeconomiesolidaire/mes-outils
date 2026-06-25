import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCrmPermission, requireUser } from "./lib";

const FLEET_PAGE_KEY = "mesoutils:gotravaux";
const ROOMS_PAGE_KEY = "mesoutils:salles";

const vehicleKind = v.union(
  v.literal("utilitaire"),
  v.literal("camionnette"),
  v.literal("camion"),
  v.literal("voiture"),
);

const site = v.union(v.literal("60"), v.literal("76"));
const taskPriority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));
const taskStatus = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
);

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

export const listVehicles = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "read");
    const [vehicles, tasks] = await Promise.all([
      ctx.db.query("vehicles").order("desc").collect(),
      ctx.db.query("vehicleMaintenanceTasks").collect(),
    ]);
    const openTasksByVehicle = new Map<string, number>();
    for (const task of tasks) {
      if (task.status === "done") continue;
      const key = String(task.vehicleId);
      openTasksByVehicle.set(key, (openTasksByVehicle.get(key) ?? 0) + 1);
    }

    return await Promise.all(
      vehicles.map(async (vehicle) => ({
        ...vehicle,
        photoUrl: vehicle.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle.photoUrl,
        openTasksCount: openTasksByVehicle.get(String(vehicle._id)) ?? 0,
      })),
    );
  },
});

export const createVehicle = mutation({
  args: {
    name: v.string(),
    plate: v.optional(v.string()),
    kind: vehicleKind,
    site: v.optional(site),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    seats: v.optional(v.number()),
    assignedTo: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "create");
    return await ctx.db.insert("vehicles", {
      ...args,
      name: args.name.trim(),
      plate: args.plate?.trim() || undefined,
      brand: args.brand?.trim() || undefined,
      model: args.model?.trim() || undefined,
      assignedTo: args.assignedTo?.trim() || undefined,
      photoUrl: args.photoUrl?.trim() || undefined,
      createdAt: Date.now(),
    });
  },
});

export const updateVehicle = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    name: v.string(),
    plate: v.optional(v.string()),
    kind: vehicleKind,
    site: v.optional(site),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    seats: v.optional(v.number()),
    assignedTo: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    odometerKm: v.optional(v.number()),
    technicalControlDate: v.optional(v.string()),
    pollutionControlDate: v.optional(v.string()),
    insuranceCompany: v.optional(v.string()),
    insurancePolicy: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, { vehicleId, ...patch }) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "update");
    await ctx.db.patch(vehicleId, {
      ...patch,
      name: patch.name.trim(),
      plate: patch.plate?.trim() || undefined,
      brand: patch.brand?.trim() || undefined,
      model: patch.model?.trim() || undefined,
      assignedTo: patch.assignedTo?.trim() || undefined,
      photoUrl: patch.photoUrl?.trim() || undefined,
      insuranceCompany: patch.insuranceCompany?.trim() || undefined,
      insurancePolicy: patch.insurancePolicy?.trim() || undefined,
    });
  },
});

export const listVehicleTasks = query({
  args: {
    vehicleId: v.optional(v.id("vehicles")),
    status: v.optional(taskStatus),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "read");
    const tasks = await ctx.db.query("vehicleMaintenanceTasks").order("desc").take(300);
    const filtered = tasks.filter((task) => {
      if (args.vehicleId && task.vehicleId !== args.vehicleId) return false;
      if (args.status && task.status !== args.status) return false;
      return true;
    });
    const vehicles = await ctx.db.query("vehicles").collect();
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));
    return filtered.map((task) => ({
      ...task,
      vehicle: vehicleById.get(String(task.vehicleId)) ?? null,
    }));
  },
});

export const createVehicleTask = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: taskPriority,
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    return await ctx.db.insert("vehicleMaintenanceTasks", {
      vehicleId: args.vehicleId,
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      priority: args.priority,
      status: "todo",
      dueDate: args.dueDate,
      createdBy: displayName(identity),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateVehicleTask = mutation({
  args: {
    taskId: v.id("vehicleMaintenanceTasks"),
    status: taskStatus,
    priority: taskPriority,
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "update");
    await ctx.db.patch(args.taskId, {
      status: args.status,
      priority: args.priority,
      updatedAt: Date.now(),
    });
  },
});

export const listRooms = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, ROOMS_PAGE_KEY, "read");
    return await ctx.db.query("rooms").order("asc").collect();
  },
});

export const createRoom = mutation({
  args: {
    name: v.string(),
    site: v.optional(site),
    capacity: v.optional(v.number()),
    color: v.optional(v.string()),
    buildingLabel: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    services: v.optional(v.array(v.string())),
    reservable: v.optional(v.boolean()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, ROOMS_PAGE_KEY, "create");
    return await ctx.db.insert("rooms", {
      ...args,
      name: args.name.trim(),
      buildingLabel: args.buildingLabel?.trim() || undefined,
      photoUrl: args.photoUrl?.trim() || undefined,
      createdAt: Date.now(),
    });
  },
});

export const updateRoom = mutation({
  args: {
    roomId: v.id("rooms"),
    name: v.string(),
    site: v.optional(site),
    capacity: v.optional(v.number()),
    color: v.optional(v.string()),
    buildingLabel: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    services: v.optional(v.array(v.string())),
    reservable: v.optional(v.boolean()),
    unavailabilityNotes: v.optional(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, { roomId, ...patch }) => {
    await requireCrmPermission(ctx, ROOMS_PAGE_KEY, "update");
    await ctx.db.patch(roomId, {
      ...patch,
      name: patch.name.trim(),
      buildingLabel: patch.buildingLabel?.trim() || undefined,
      photoUrl: patch.photoUrl?.trim() || undefined,
      unavailabilityNotes: patch.unavailabilityNotes?.trim() || undefined,
    });
  },
});
