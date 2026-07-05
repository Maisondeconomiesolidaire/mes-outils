import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { normalizeCustomer, titleCaseName } from "./lib";
import { resolveProcess } from "./processes";

const rawField = v.object({ key: v.string(), value: v.string() });
const legacyRow = v.object({
  sourceId: v.string(),
  fields: v.array(rawField),
});

const customerPayload = v.object({
  sourceId: v.string(),
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  phone: v.string(),
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
  customerType: v.optional(v.string()),
  streetNumber: v.optional(v.string()),
  street: v.optional(v.string()),
  legacyCreatedAt: v.optional(v.number()),
  legacyModifiedAt: v.optional(v.number()),
  raw: v.array(rawField),
});

const customer = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  phone: v.string(),
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
});

const address = v.object({
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
});

const collectePayload = v.object({
  sourceId: v.string(),
  reference: v.string(),
  customer,
  createdAt: v.number(),
  updatedAt: v.number(),
  complete: v.boolean(),
  outcome: v.union(v.literal("open"), v.literal("perdue")),
  site: v.optional(v.union(v.literal("60"), v.literal("76"))),
  visitNeeded: v.optional(v.boolean()),
  collecteType: v.union(
    v.literal("indefini"),
    v.literal("C1"),
    v.literal("C2"),
    v.literal("C3"),
  ),
  comment: v.optional(v.string()),
  quoteDetails: v.optional(v.string()),
  quoteAmount: v.optional(v.number()),
  details: v.object({
    dismountable: v.optional(v.boolean()),
    reusableGoodCondition: v.optional(v.boolean()),
    sorted: v.optional(v.boolean()),
    noWaste: v.optional(v.boolean()),
    objectCategories: v.optional(v.array(v.string())),
    housingType: v.optional(v.string()),
    floors: v.optional(v.number()),
    dedicatedParking: v.optional(v.boolean()),
    parkingDistance: v.optional(v.number()),
    parkingNearby: v.optional(v.boolean()),
    collectAddress: v.optional(address),
  }),
  raw: legacyRow,
});

const aerogommageItem = v.object({
  sourceId: v.string(),
  objectType: v.optional(v.string()),
  label: v.optional(v.string()),
  height: v.optional(v.number()),
  width: v.optional(v.number()),
  depth: v.optional(v.number()),
  quantity: v.optional(v.number()),
  woodType: v.optional(v.string()),
  stripping: v.optional(v.string()),
  coating: v.optional(v.string()),
  coatingOther: v.optional(v.string()),
  delivery: v.optional(v.boolean()),
  retrieval: v.optional(v.boolean()),
  comment: v.optional(v.string()),
  raw: legacyRow,
});

const aerogommagePayload = v.object({
  reference: v.string(),
  sourceIds: v.array(v.string()),
  customer,
  createdAt: v.number(),
  updatedAt: v.number(),
  complete: v.boolean(),
  site: v.optional(v.union(v.literal("60"), v.literal("76"))),
  comment: v.optional(v.string()),
  quoteAmount: v.optional(v.number()),
  estimatedHours: v.optional(v.number()),
  actualHours: v.optional(v.number()),
  aerogommageOptions: v.optional(
    v.object({
      pickupAtHome: v.optional(v.boolean()),
      deliveryAtHome: v.optional(v.boolean()),
      pickupAddress: v.optional(address),
      deliveryAddress: v.optional(address),
    }),
  ),
  items: v.array(aerogommageItem),
});

function cleanObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export const importRecycappLegacy = internalMutation({
  args: {
    customers: v.array(customerPayload),
    collectes: v.array(collectePayload),
    aerogommages: v.array(aerogommagePayload),
  },
  handler: async (ctx, args) => {
    let customersInserted = 0;
    let customersUpdated = 0;
    let requestsInserted = 0;
    let requestsUpdated = 0;

    for (const imported of args.customers) {
      const now = Date.now();
      const email = imported.email.trim().toLowerCase();
      const payload = cleanObject({
        source: "bubble:clients",
        sourceId: imported.sourceId,
        firstName: titleCaseName(imported.firstName || "Client"),
        lastName: titleCaseName(imported.lastName || "Importé"),
        email,
        phone: imported.phone.trim(),
        address: imported.address,
        postalCode: imported.postalCode,
        city: imported.city,
        customerType: imported.customerType,
        streetNumber: imported.streetNumber,
        street: imported.street,
        legacyCreatedAt: imported.legacyCreatedAt,
        legacyModifiedAt: imported.legacyModifiedAt,
        raw: imported.raw,
        updatedAt: now,
      });
      const existing = await ctx.db
        .query("crmCustomers")
        .withIndex("by_sourceId", (q) => q.eq("sourceId", imported.sourceId))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        customersUpdated++;
      } else {
        await ctx.db.insert("crmCustomers", { ...payload, createdAt: now });
        customersInserted++;
      }
    }

    for (const imported of args.collectes) {
      const processSteps = resolveProcess("collecte", imported.collecteType);
      const existing = await ctx.db
        .query("requests")
        .withIndex("by_reference", (q) => q.eq("reference", imported.reference))
        .filter((q) => q.eq(q.field("type"), "collecte"))
        .first();
      const payload = cleanObject({
        type: "collecte" as const,
        stage: "nouveau" as const,
        outcome: imported.outcome,
        lostReason: imported.outcome === "perdue" ? ("autre" as const) : undefined,
        lostReasonDetails:
          imported.outcome === "perdue" ? "Import Bubble : marqué non collectable." : undefined,
        requestOrigin: "external" as const,
        complete: imported.complete,
        collecteType: imported.collecteType,
        processSteps,
        completedSteps: 0,
        site: imported.site,
        customer: normalizeCustomer(imported.customer),
        comment: imported.comment,
        photos: [],
        collecte: cleanObject(imported.details),
        quoteDetails: imported.quoteDetails,
        quoteAmount: imported.quoteAmount,
        visitNeeded: imported.visitNeeded,
        createdAt: imported.createdAt,
        updatedAt: imported.updatedAt,
        reference: imported.reference,
        legacyImport: {
          source: "bubble:debarras",
          sourceIds: [imported.sourceId],
          raw: [imported.raw],
        },
      });
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        requestsUpdated++;
      } else {
        await ctx.db.insert("requests", payload);
        requestsInserted++;
      }
    }

    for (const imported of args.aerogommages) {
      const existing = await ctx.db
        .query("requests")
        .withIndex("by_reference", (q) => q.eq("reference", imported.reference))
        .filter((q) => q.eq(q.field("type"), "aerogommage"))
        .first();
      const payload = cleanObject({
        type: "aerogommage" as const,
        stage: "nouveau" as const,
        outcome: "open" as const,
        requestOrigin: "external" as const,
        complete: imported.complete,
        processSteps: resolveProcess("aerogommage"),
        completedSteps: 0,
        site: imported.site,
        customer: normalizeCustomer(imported.customer),
        comment: imported.comment,
        photos: [],
        aerogommage: imported.items.map((item) =>
          cleanObject({
            objectType: item.objectType,
            label: item.label,
            height: item.height,
            width: item.width,
            depth: item.depth,
            quantity: item.quantity,
            woodType: item.woodType,
            stripping: item.stripping,
            coating: item.coating,
            coatingOther: item.coatingOther,
            delivery: item.delivery,
            retrieval: item.retrieval,
            comment: item.comment,
          }),
        ),
        aerogommageOptions: imported.aerogommageOptions,
        quoteAmount: imported.quoteAmount,
        estimatedHours: imported.estimatedHours,
        actualHours: imported.actualHours,
        createdAt: imported.createdAt,
        updatedAt: imported.updatedAt,
        reference: imported.reference,
        legacyImport: {
          source: "bubble:aerogommages",
          sourceIds: imported.sourceIds,
          raw: imported.items.map((item) => item.raw),
        },
      });
      if (existing) {
        await ctx.db.patch(existing._id, payload);
        requestsUpdated++;
      } else {
        await ctx.db.insert("requests", payload);
        requestsInserted++;
      }
    }

    return {
      customersInserted,
      customersUpdated,
      requestsInserted,
      requestsUpdated,
    };
  },
});
