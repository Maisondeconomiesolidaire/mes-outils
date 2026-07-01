import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireCrmPermission, requireUser } from "./lib";
import { bpMaterial, bpUnit } from "./schema";

/* ─── Entreprises ─────────────────────────────────────────────────────────── */

export const listCompanies = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "read");
    const companies = await ctx.db.query("bpCompanies").order("desc").collect();
    return companies.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

export const getCompany = query({
  args: { companyId: v.id("bpCompanies") },
  handler: async (ctx, { companyId }) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "read");
    const company = await ctx.db.get(companyId);
    if (!company) return null;
    const vehicles = await ctx.db
      .query("bpVehicles")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    return { ...company, vehicles };
  },
});

export const createCompany = mutation({
  args: {
    name: v.string(),
    siret: v.optional(v.string()),
    address: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "create");
    return await ctx.db.insert("bpCompanies", {
      ...args,
      name: args.name.trim(),
      createdAt: Date.now(),
    });
  },
});

export const updateCompany = mutation({
  args: {
    companyId: v.id("bpCompanies"),
    name: v.string(),
    siret: v.optional(v.string()),
    address: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, ...patch }) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "update");
    await ctx.db.patch(companyId, { ...patch, name: patch.name.trim() });
  },
});

/* ─── Véhicules ───────────────────────────────────────────────────────────── */

export const listVehicles = query({
  args: { companyId: v.id("bpCompanies") },
  handler: async (ctx, { companyId }) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "read");
    return await ctx.db
      .query("bpVehicles")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
  },
});

export const addVehicle = mutation({
  args: {
    companyId: v.id("bpCompanies"),
    label: v.string(),
    plate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "update");
    return await ctx.db.insert("bpVehicles", {
      ...args,
      label: args.label.trim(),
      createdAt: Date.now(),
    });
  },
});

export const updateVehicle = mutation({
  args: {
    vehicleId: v.id("bpVehicles"),
    label: v.string(),
    plate: v.optional(v.string()),
  },
  handler: async (ctx, { vehicleId, ...patch }) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "update");
    await ctx.db.patch(vehicleId, { ...patch, label: patch.label.trim() });
  },
});

export const removeVehicle = mutation({
  args: { vehicleId: v.id("bpVehicles") },
  handler: async (ctx, { vehicleId }) => {
    await requireCrmPermission(ctx, "bennespro:entreprises", "delete");
    await ctx.db.delete(vehicleId);
  },
});

/* ─── Dépôts ──────────────────────────────────────────────────────────────── */

const depotItem = v.object({
  material: bpMaterial,
  unit: bpUnit,
  quantity: v.number(),
  siteRef: v.string(),
});

async function resolveStorageUrls<T extends Record<string, unknown>>(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  ids: Array<Id<"_storage"> | undefined>,
) {
  return Promise.all(ids.map((id) => (id ? ctx.storage.getUrl(id) : Promise.resolve(null))));
}

export const listDepots = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, "bennespro:depots", "read");
    const depots = await ctx.db.query("bpDepots").order("desc").collect();
    return Promise.all(
      depots.map(async (depot) => {
        const company = await ctx.db.get(depot.companyId);
        const vehicle = await ctx.db.get(depot.vehicleId);
        return {
          ...depot,
          companyName: company?.name ?? "—",
          vehicleLabel: vehicle?.label ?? "—",
        };
      }),
    );
  },
});

export const getDepot = query({
  args: { depotId: v.id("bpDepots") },
  handler: async (ctx, { depotId }) => {
    await requireCrmPermission(ctx, "bennespro:depots", "read");
    const depot = await ctx.db.get(depotId);
    if (!depot) return null;
    const company = await ctx.db.get(depot.companyId);
    const vehicle = await ctx.db.get(depot.vehicleId);
    const [ticketUrl, truckExteriorUrl, truckInteriorUrl, signatureUrl] =
      await resolveStorageUrls(ctx, [
        depot.ticketPhoto,
        depot.truckExteriorPhoto,
        depot.truckInteriorPhoto,
        depot.signature,
      ]);
    const attachmentUrls = await Promise.all(
      depot.attachments.map((id) => ctx.storage.getUrl(id)),
    );
    return {
      ...depot,
      company,
      vehicle,
      ticketUrl,
      truckExteriorUrl,
      truckInteriorUrl,
      signatureUrl,
      attachmentUrls,
    };
  },
});

export const createDepot = mutation({
  args: {
    companyId: v.id("bpCompanies"),
    vehicleId: v.id("bpVehicles"),
    depositorName: v.string(),
    siteRef: v.string(),
    items: v.array(depotItem),
    ticketPhoto: v.optional(v.id("_storage")),
    truckExteriorPhoto: v.optional(v.id("_storage")),
    truckInteriorPhoto: v.optional(v.id("_storage")),
    attachments: v.array(v.id("_storage")),
    comment: v.optional(v.string()),
    signature: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "bennespro:depots", "create");
    const identity = await requireUser(ctx);
    const all = await ctx.db.query("bpDepots").collect();
    const depotNumber = all.length + 1;
    return await ctx.db.insert("bpDepots", {
      ...args,
      depotNumber,
      createdBy: identity.email ?? undefined,
      createdAt: Date.now(),
    });
  },
});
