/**
 * Clients Klyd.
 *
 * Les acheteurs ne sont saisis nulle part : ils arrivent par les emails Vinted,
 * qui portent le pseudo, et pour une vente Pro le nom et l'adresse de
 * facturation. Cette page les reconstitue à la lecture, et laisse ajouter à la
 * main ce qui n'a pas transité par Vinted — une vente en boutique, un contact
 * pris sur un marché.
 *
 * Rien n'est recopié dans une table au moment de l'import : un client dérivé
 * reste le reflet de ses emails, et ne peut donc pas diverger d'eux.
 */
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireCrmPermission } from "./lib";

const PAGE_KEY = "klyde:clients";

const OUTLET = v.union(v.literal("klyd"), v.literal("mobifrip"));

/** Emails dont on peut tirer un acheteur : une vente, ou une offre acceptée. */
const CUSTOMER_KINDS = new Set(["vente", "offre", "expedition", "bordereau"]);

function clean(value?: string) {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Clé de regroupement d'un acheteur.
 *
 * L'email est le seul identifiant fiable ; à défaut le pseudo Vinted, puis le
 * nom. Deux acheteurs homonymes sans email ni pseudo se retrouvent donc
 * fondus — c'est le prix à payer pour ne pas éclater un même client en autant
 * de lignes que d'emails reçus.
 */
function customerKey(parts: { email?: string; pseudo?: string; name?: string }) {
  if (parts.email) return `email:${parts.email.toLowerCase()}`;
  if (parts.pseudo) return `pseudo:${normalize(parts.pseudo)}`;
  if (parts.name) return `name:${normalize(parts.name)}`;
  return null;
}

export type CustomerRow = {
  key: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  vintedPseudo?: string;
  note?: string;
  outlets: Array<"klyd" | "mobifrip">;
  /** Nombre d'achats identifiés dans les emails. */
  orders: number;
  /** Total dépensé, sur les seuls emails qui portent un montant. */
  spent: number;
  firstOrderAt?: number;
  lastOrderAt?: number;
  /** Derniers articles achetés, du plus récent au plus ancien. */
  items: Array<{ title: string; amount?: number; at: number }>;
  /** Fiche saisie à la main, quand il y en a une (seule modifiable). */
  manualId?: string;
  source: "email" | "manuel" | "les-deux";
};

async function buildCustomers(ctx: QueryCtx): Promise<CustomerRow[]> {
  const [emails, manuals] = await Promise.all([
    ctx.db.query("klydeVintedEmails").collect(),
    ctx.db.query("klydeCustomers").collect(),
  ]);

  const rows = new Map<string, CustomerRow>();

  for (const email of emails) {
    if (!CUSTOMER_KINDS.has(email.kind)) continue;
    const address = clean(email.buyerAddress);
    const buyerEmail = clean(email.buyerEmail)?.toLowerCase();
    const pseudo = clean(email.buyer);
    const name = clean(email.buyerName) ?? pseudo;
    if (!name && !buyerEmail) continue;
    const key = customerKey({ email: buyerEmail, pseudo, name });
    if (!key) continue;

    const existing = rows.get(key);
    const row: CustomerRow = existing ?? {
      key,
      name: name ?? buyerEmail ?? "Acheteur inconnu",
      email: buyerEmail,
      address,
      vintedPseudo: pseudo,
      outlets: [],
      orders: 0,
      spent: 0,
      items: [],
      source: "email",
    };

    // Les coordonnées les plus récentes l'emportent : une adresse change, et
    // l'email de vente le plus récent est celui qui fait foi pour la livraison.
    if (!existing || email.sentAt >= (row.lastOrderAt ?? 0)) {
      if (name) row.name = name;
      if (buyerEmail) row.email = buyerEmail;
      if (address) row.address = address;
      if (pseudo) row.vintedPseudo = pseudo;
    }
    if (email.outlet && !row.outlets.includes(email.outlet)) row.outlets.push(email.outlet);
    // Seule une vente compte comme achat : un bordereau ou une expédition
    // portent sur la même commande et la compteraient deux fois.
    if (email.kind === "vente") {
      row.orders += 1;
      row.spent += email.amount ?? 0;
      row.items.push({
        title: clean(email.itemTitle) ?? clean(email.subject) ?? "Article",
        amount: email.amount,
        at: email.sentAt,
      });
    }
    row.firstOrderAt = Math.min(row.firstOrderAt ?? email.sentAt, email.sentAt);
    row.lastOrderAt = Math.max(row.lastOrderAt ?? email.sentAt, email.sentAt);
    rows.set(key, row);
  }

  // Fiches manuelles : elles complètent un acheteur déjà connu (même email ou
  // même pseudo) plutôt que d'ouvrir une ligne de plus.
  for (const manual of manuals) {
    const manualEmail = clean(manual.email)?.toLowerCase();
    const key =
      customerKey({ email: manualEmail, pseudo: clean(manual.vintedPseudo), name: manual.name }) ??
      `manuel:${manual._id}`;
    const existing = rows.get(key);
    if (existing) {
      rows.set(key, {
        ...existing,
        name: manual.name || existing.name,
        email: manualEmail ?? existing.email,
        phone: clean(manual.phone) ?? existing.phone,
        address: clean(manual.address) ?? existing.address,
        vintedPseudo: clean(manual.vintedPseudo) ?? existing.vintedPseudo,
        note: clean(manual.note) ?? existing.note,
        manualId: manual._id,
        source: "les-deux",
      });
      continue;
    }
    rows.set(key, {
      key,
      name: manual.name,
      email: manualEmail,
      phone: clean(manual.phone),
      address: clean(manual.address),
      vintedPseudo: clean(manual.vintedPseudo),
      note: clean(manual.note),
      outlets: manual.outlet ? [manual.outlet] : [],
      orders: 0,
      spent: 0,
      items: [],
      manualId: manual._id,
      source: "manuel",
    });
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      spent: Math.round(row.spent * 100) / 100,
      items: row.items.sort((a, b) => b.at - a.at).slice(0, 12),
    }))
    .sort((a, b) => (b.lastOrderAt ?? 0) - (a.lastOrderAt ?? 0) || a.name.localeCompare(b.name, "fr"));
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const customers = await buildCustomers(ctx);
    return {
      customers,
      stats: {
        total: customers.length,
        fromEmails: customers.filter((row) => row.source !== "manuel").length,
        manual: customers.filter((row) => row.source !== "email").length,
        revenue:
          Math.round(customers.reduce((total, row) => total + row.spent, 0) * 100) / 100,
        repeat: customers.filter((row) => row.orders > 1).length,
      },
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    vintedPseudo: v.optional(v.string()),
    note: v.optional(v.string()),
    outlet: v.optional(OUTLET),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const name = args.name.trim();
    if (!name) throw new Error("Renseignez le nom du client.");
    const identity = await ctx.auth.getUserIdentity();
    return await ctx.db.insert("klydeCustomers", {
      name,
      email: clean(args.email)?.toLowerCase(),
      phone: clean(args.phone),
      address: clean(args.address),
      vintedPseudo: clean(args.vintedPseudo),
      note: clean(args.note),
      outlet: args.outlet,
      createdByClerkId: identity?.subject ?? "inconnu",
      createdByName: identity?.name ?? undefined,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("klydeCustomers"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    vintedPseudo: v.optional(v.string()),
    note: v.optional(v.string()),
    outlet: v.optional(OUTLET),
  },
  handler: async (ctx, { id, ...rest }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    const name = rest.name.trim();
    if (!name) throw new Error("Renseignez le nom du client.");
    await ctx.db.patch(id, {
      name,
      email: clean(rest.email)?.toLowerCase(),
      phone: clean(rest.phone),
      address: clean(rest.address),
      vintedPseudo: clean(rest.vintedPseudo),
      note: clean(rest.note),
      outlet: rest.outlet,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("klydeCustomers") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    await ctx.db.delete(id);
  },
});
