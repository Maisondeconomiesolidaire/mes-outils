import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { accessAllows, customerFullName, requireCrmPermission, requireUser } from "./lib";
import { buildAddressString, drivingDistanceKm, geocode } from "./livraison";
import type { Id } from "./_generated/dataModel";

const FLEET_PAGE_KEY = "mesoutils:gotravaux";
const ROOMS_PAGE_KEY = "mesoutils:salles";

/** Dépôt de départ pour le calcul des distances (identique aux tournées / livraisons). */
const DEPOT_ADDRESS = "4 rue de la prairie 60650 Lachapelle-aux-Pots";

const vehicleKind = v.union(
  v.literal("utilitaire"),
  v.literal("voiture"),
);

function normalizeVehicleKind(kind: string) {
  return kind === "voiture" ? "voiture" : "utilitaire";
}

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
        kind: normalizeVehicleKind(vehicle.kind),
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
    photo: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    odometerKm: v.optional(v.number()),
    technicalControlDate: v.optional(v.string()),
    pollutionControlDate: v.optional(v.string()),
    recycappEnabled: v.optional(v.boolean()),
    reservablePro: v.optional(v.boolean()),
    reservablePersonal: v.optional(v.boolean()),
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
      odometerUpdatedAt: typeof args.odometerKm === "number" ? new Date().toISOString() : undefined,
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
    photo: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    odometerKm: v.optional(v.number()),
    technicalControlDate: v.optional(v.string()),
    pollutionControlDate: v.optional(v.string()),
    insuranceCompany: v.optional(v.string()),
    insurancePolicy: v.optional(v.string()),
    saleDate: v.optional(v.string()),
    recycappEnabled: v.optional(v.boolean()),
    reservablePro: v.optional(v.boolean()),
    reservablePersonal: v.optional(v.boolean()),
    active: v.boolean(),
  },
  handler: async (ctx, { vehicleId, ...patch }) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "update");
    const existing = await ctx.db.get(vehicleId);
    const odometerChanged =
      typeof patch.odometerKm === "number" && patch.odometerKm !== existing?.odometerKm;
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
      saleDate: patch.saleDate?.trim() || undefined,
      ...(odometerChanged ? { odometerUpdatedAt: new Date().toISOString() } : {}),
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
    endDate: v.optional(v.number()),
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
      endDate: args.endDate,
      createdBy: displayName(identity),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

const documentCategory = v.union(
  v.literal("carte_grise"),
  v.literal("facture"),
  v.literal("devis"),
  v.literal("assurance"),
  v.literal("controle_technique"),
  v.literal("autre"),
);

export const listVehicleDocuments = query({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "read");
    const documents = await ctx.db
      .query("vehicleDocuments")
      .withIndex("by_vehicleId", (q) => q.eq("vehicleId", args.vehicleId))
      .order("desc")
      .collect();
    return await Promise.all(
      documents.map(async (document) => ({
        ...document,
        url: await ctx.storage.getUrl(document.storageId),
      })),
    );
  },
});

export const addVehicleDocument = mutation({
  args: {
    vehicleId: v.id("vehicles"),
    name: v.string(),
    category: documentCategory,
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "update");
    const identity = await requireUser(ctx);
    return await ctx.db.insert("vehicleDocuments", {
      vehicleId: args.vehicleId,
      name: args.name.trim() || "Document",
      category: args.category,
      storageId: args.storageId,
      uploadedBy: displayName(identity),
      createdAt: Date.now(),
    });
  },
});

export const removeVehicleDocument = mutation({
  args: { documentId: v.id("vehicleDocuments") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "update");
    await ctx.db.delete(args.documentId);
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

/* ─── Services planifiés avec véhicule affecté (calendrier flotte) ─────────── */

/** Adresse pertinente où le véhicule se rend pour un service donné. */
function resolveServiceAddress(request: {
  collecte?: { collectAddress?: { address?: string; postalCode?: string; city?: string } };
  livraison?: { deliveryAddress?: { address?: string; postalCode?: string; city?: string } };
  aerogommageOptions?: {
    deliveryAddress?: { address?: string; postalCode?: string; city?: string };
    pickupAddress?: { address?: string; postalCode?: string; city?: string };
  };
  customer: { address?: string; postalCode?: string; city?: string };
}) {
  const candidates = [
    request.collecte?.collectAddress,
    request.livraison?.deliveryAddress,
    request.aerogommageOptions?.deliveryAddress,
    request.aerogommageOptions?.pickupAddress,
  ];
  for (const candidate of candidates) {
    if (candidate?.address) return candidate;
  }
  return {
    address: request.customer.address,
    postalCode: request.customer.postalCode,
    city: request.customer.city,
  };
}

/**
 * Demandes ouvertes (collecte, livraison, aérogommage…) ayant un véhicule de la
 * flotte affecté et une date planifiée — pour les afficher dans le calendrier
 * Gotravaux à côté des réservations et des maintenances.
 */
export const listScheduledServices = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "read");
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_outcome", (q) => q.eq("outcome", "open"))
      .collect();
    const scheduled = requests.filter(
      (request) => request.assignedVehicle && request.scheduledDate,
    );
    if (scheduled.length === 0) return [];

    const vehicles = await ctx.db.query("vehicles").collect();
    const vehicleById = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle]));

    return await Promise.all(
      scheduled.map(async (request) => {
        const vehicle = vehicleById.get(String(request.assignedVehicle));
        const address = resolveServiceAddress(request);
        return {
          _id: request._id,
          type: request.type,
          collecteType: request.collecteType ?? null,
          reference: request.reference ?? null,
          scheduledDate: request.scheduledDate as number,
          vehicleId: request.assignedVehicle as Id<"vehicles">,
          vehicleName: vehicle?.name ?? null,
          vehiclePlate: vehicle?.plate ?? null,
          vehiclePhotoUrl: vehicle?.photo
            ? await ctx.storage.getUrl(vehicle.photo)
            : (vehicle?.photoUrl ?? null),
          customerName: customerFullName(request.customer),
          address: address.address ?? null,
          postalCode: address.postalCode ?? null,
          city: address.city ?? null,
          // Distance déjà calculée (livraison) : aller-retour, indicative.
          storedDistanceKm: request.livraison?.distanceKm ?? null,
        };
      }),
    );
  },
});

/**
 * Distance routière (km, aller simple) entre le dépôt et l'adresse d'un service,
 * via Mapbox. Calculée à la demande depuis la modale détail du calendrier.
 */
export const computeServiceDistance = action({
  args: {
    address: v.string(),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ distanceKm: number }> => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, FLEET_PAGE_KEY, "read")) {
      throw new Error("Accès CRM insuffisant.");
    }
    const accessToken = process.env.MAPBOX_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error("MAPBOX_ACCESS_TOKEN n'est pas configurée côté Convex.");
    }
    const destination = buildAddressString(args);
    if (!destination) throw new Error("Adresse du service manquante.");

    const [depot, target] = await Promise.all([
      geocode(DEPOT_ADDRESS, accessToken),
      geocode(destination, accessToken),
    ]);
    const oneWayKm = await drivingDistanceKm(depot, target, accessToken);
    return { distanceKm: Math.round(oneWayKm * 10) / 10 };
  },
});

export const listRooms = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, ROOMS_PAGE_KEY, "read");
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
    site: v.optional(site),
    capacity: v.optional(v.number()),
    color: v.optional(v.string()),
    buildingLabel: v.optional(v.string()),
    photo: v.optional(v.id("_storage")),
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
    photo: v.optional(v.id("_storage")),
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
