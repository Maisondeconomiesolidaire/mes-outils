import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireCrmPermission, normalizeCustomer, titleCaseName } from "./lib";
import { RequestType } from "./processes";

type ClientRow = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
  requestCount: number;
  lastAt: number;
  types: RequestType[];
};

/**
 * Liste agrégée des clients, déduite des demandes et des prospects importés
 * (regroupés par email).
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<ClientRow[]> => {
    await requireCrmPermission(ctx, "clients", "read");
    const [requests, importedCustomers] = await Promise.all([
      ctx.db.query("requests").order("desc").collect(),
      ctx.db.query("crmCustomers").order("desc").collect(),
    ]);
    const map = new Map<string, ClientRow>();

    for (const r of requests) {
      const email = r.customer.email.trim().toLowerCase();
      if (!email) continue;
      const existing = map.get(email);
      if (existing) {
        existing.requestCount++;
        existing.lastAt = Math.max(existing.lastAt, r.createdAt);
        if (!existing.types.includes(r.type)) existing.types.push(r.type);
        // Complète l'adresse si elle manquait.
        if (!existing.address && r.customer.address) {
          existing.address = r.customer.address;
          existing.postalCode = r.customer.postalCode;
          existing.city = r.customer.city;
        }
      } else {
        map.set(email, {
          email: r.customer.email,
          firstName: titleCaseName(r.customer.firstName),
          lastName: titleCaseName(r.customer.lastName),
          phone: r.customer.phone,
          address: r.customer.address,
          postalCode: r.customer.postalCode,
          city: r.customer.city,
          requestCount: 1,
          lastAt: r.createdAt,
          types: [r.type],
        });
      }
    }

    for (const c of importedCustomers) {
      const email = c.email.trim().toLowerCase();
      if (!email || map.has(email)) continue;
      map.set(email, {
        email: c.email,
        firstName: titleCaseName(c.firstName),
        lastName: titleCaseName(c.lastName),
        phone: c.phone,
        address: c.address,
        postalCode: c.postalCode,
        city: c.city,
        requestCount: 0,
        lastAt: c.legacyModifiedAt ?? c.updatedAt,
        types: [],
      });
    }

    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
  },
});

/** Fiche client : ses coordonnées + toutes ses demandes (par email). */
export const get = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    await requireCrmPermission(ctx, "clients", "read");
    const target = email.trim().toLowerCase();
    const [all, imported] = await Promise.all([
      ctx.db.query("requests").order("desc").collect(),
      ctx.db
        .query("crmCustomers")
        .withIndex("by_email", (q) => q.eq("email", target))
        .first(),
    ]);
    const requests = all.filter((r) => r.customer.email.trim().toLowerCase() === target);
    if (requests.length === 0 && !imported) return null;
    const customer =
      requests.length > 0
        ? normalizeCustomer(requests[0].customer)
        : normalizeCustomer({
            firstName: imported!.firstName,
            lastName: imported!.lastName,
            email: imported!.email,
            phone: imported!.phone,
            address: imported!.address,
            postalCode: imported!.postalCode,
            city: imported!.city,
          });
    return {
      customer,
      requests: requests.map((r) => ({ ...r, customer: normalizeCustomer(r.customer) })),
    };
  },
});
