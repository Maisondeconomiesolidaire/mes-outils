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
 * Liste agrégée des clients, déduite des demandes (regroupées par email).
 * Pas de table dédiée : un client existe dès qu'il a soumis une demande.
 */
export const list = query({
  args: {},
  handler: async (ctx): Promise<ClientRow[]> => {
    await requireCrmPermission(ctx, "clients", "read");
    const requests = await ctx.db.query("requests").order("desc").collect();
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

    return [...map.values()].sort((a, b) => b.lastAt - a.lastAt);
  },
});

/** Fiche client : ses coordonnées + toutes ses demandes (par email). */
export const get = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    await requireCrmPermission(ctx, "clients", "read");
    const target = email.trim().toLowerCase();
    const all = await ctx.db.query("requests").order("desc").collect();
    const requests = all.filter(
      (r) => r.customer.email.trim().toLowerCase() === target,
    );
    if (requests.length === 0) return null;
    return {
      customer: normalizeCustomer(requests[0].customer),
      requests: requests.map((r) => ({ ...r, customer: normalizeCustomer(r.customer) })),
    };
  },
});
