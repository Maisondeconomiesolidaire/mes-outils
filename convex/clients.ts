import { mutation, query } from "./_generated/server";
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

/**
 * Recherche rapide d'un client par email ou par nom, pour la caisse.
 *
 * La liste complète des clients est reconstruite à chaque appel à partir de
 * toutes les demandes : trop lourd pour une saisie au clavier. On filtre donc
 * ici, et on ne renvoie que le strict nécessaire à l'identification.
 */
export const search = query({
  args: { searchText: v.string() },
  handler: async (ctx, { searchText }) => {
    await requireCrmPermission(ctx, "clients", "read");
    const needle = searchText.trim().toLowerCase();
    if (needle.length < 2) return [];

    const [requests, importedCustomers] = await Promise.all([
      ctx.db.query("requests").order("desc").take(2000),
      ctx.db.query("crmCustomers").order("desc").take(2000),
    ]);

    const found = new Map<
      string,
      {
        email: string;
        firstName: string;
        lastName: string;
        phone: string;
        requestCount: number;
        lastAt: number;
      }
    >();

    function consider(
      customer: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
      },
      at: number,
      counts: boolean,
    ) {
      const email = customer.email.trim().toLowerCase();
      if (!email) return;
      const haystack =
        `${customer.firstName} ${customer.lastName} ${email}`.toLowerCase();
      if (!haystack.includes(needle)) return;

      const existing = found.get(email);
      if (existing) {
        if (counts) existing.requestCount += 1;
        existing.lastAt = Math.max(existing.lastAt, at);
        return;
      }
      found.set(email, {
        email: customer.email,
        firstName: titleCaseName(customer.firstName),
        lastName: titleCaseName(customer.lastName),
        phone: customer.phone,
        requestCount: counts ? 1 : 0,
        lastAt: at,
      });
    }

    for (const request of requests) {
      consider(request.customer, request.createdAt, true);
    }
    for (const customer of importedCustomers) {
      consider(customer, customer.updatedAt, false);
    }

    return [...found.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 12);
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

/* ─── Modification et suppression d'une fiche client ──────────────────────── */

/**
 * Met à jour un client.
 *
 * Une fiche client n'existe pas en tant que telle : elle est agrégée depuis les
 * demandes, qui portent chacune leur copie des coordonnées, et depuis les
 * prospects importés. Corriger un client, c'est donc corriger toutes ses
 * demandes — sans quoi l'agrégat afficherait de nouveau l'ancienne valeur au
 * prochain calcul.
 */
export const update = mutation({
  args: {
    email: v.string(),
    firstName: v.string(),
    lastName: v.string(),
    phone: v.string(),
    /** Nouvelle adresse email, si elle change (elle sert de clé de regroupement). */
    newEmail: v.optional(v.string()),
    address: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "clients", "update");
    const target = args.email.trim().toLowerCase();
    if (!target) throw new Error("Client introuvable.");
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName && !lastName) throw new Error("Renseignez le nom du client.");
    const nextEmail = (args.newEmail ?? args.email).trim().toLowerCase();
    if (!nextEmail.includes("@")) throw new Error("Adresse email invalide.");

    const text = (value?: string) => value?.trim() || undefined;
    const fields = {
      firstName,
      lastName,
      email: nextEmail,
      phone: args.phone.trim(),
      address: text(args.address),
      postalCode: text(args.postalCode),
      city: text(args.city),
    };

    const requests = await ctx.db.query("requests").collect();
    const mine = requests.filter(
      (request) => request.customer.email.trim().toLowerCase() === target,
    );
    for (const request of mine) {
      await ctx.db.patch(request._id, {
        customer: { ...request.customer, ...fields },
      });
    }

    const imported = await ctx.db
      .query("crmCustomers")
      .withIndex("by_email", (q) => q.eq("email", target))
      .collect();
    for (const customer of imported) {
      await ctx.db.patch(customer._id, { ...fields, updatedAt: Date.now() });
    }

    if (mine.length === 0 && imported.length === 0) {
      throw new Error("Client introuvable.");
    }
    return { requests: mine.length, imported: imported.length, email: nextEmail };
  },
});

/**
 * Supprime un client.
 *
 * Seule la fiche prospect importée est supprimable : un client qui a des
 * demandes n'existe qu'à travers elles, et les effacer emporterait des dossiers
 * (devis, photos, factures). L'appelant est renvoyé vers la suppression d'une
 * demande, qui est un geste distinct et tracé.
 */
export const remove = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    await requireCrmPermission(ctx, "clients", "delete");
    const target = email.trim().toLowerCase();
    const requests = await ctx.db.query("requests").collect();
    const linked = requests.filter(
      (request) => request.customer.email.trim().toLowerCase() === target,
    );
    if (linked.length > 0) {
      throw new Error(
        `Ce client a ${linked.length} demande${linked.length > 1 ? "s" : ""} : supprimez-les d'abord depuis la fiche de chaque demande.`,
      );
    }
    const imported = await ctx.db
      .query("crmCustomers")
      .withIndex("by_email", (q) => q.eq("email", target))
      .collect();
    if (imported.length === 0) throw new Error("Client introuvable.");
    for (const customer of imported) await ctx.db.delete(customer._id);
    return { removed: imported.length };
  },
});
