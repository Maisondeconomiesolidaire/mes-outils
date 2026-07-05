import {
  action,
  env,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { accessAllows, requireCrmPermission, requireUser } from "./lib";
import { resendSend } from "./emails";
import { bpBilling, bpMaterial, bpUnit } from "./schema";

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

async function resolveStorageUrls(
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
    // Dernier numéro via l'index (évite de charger toute la table).
    const last = await ctx.db
      .query("bpDepots")
      .withIndex("by_number")
      .order("desc")
      .first();
    const depotNumber = (last?.depotNumber ?? 0) + 1;

    // Seul le DIB est facturé, au poids (kg / tonne), au tarif courant.
    const weightKg = dibWeightKg(args.items);
    const priceCentsPerKg = await readDibPrice(ctx);
    const amountCents = Math.round(weightKg * priceCentsPerKg);
    const billing =
      amountCents > 0
        ? { weightKg, priceCentsPerKg, amountCents, status: "pending" as const }
        : undefined;

    const depotId = await ctx.db.insert("bpDepots", {
      ...args,
      depotNumber,
      billing,
      createdBy: identity.email ?? undefined,
      createdAt: Date.now(),
    });
    if (billing) {
      await ctx.scheduler.runAfter(0, internal.bennespro.invoiceDepotDib, { depotId });
    }
    return { depotId, depotNumber };
  },
});

/* ─── DIB : réglages & facturation Stripe ─────────────────────────────────── */

/** Matériau facturé (seul flux payant, au kg). */
const DIB_MATERIAL = "Tout venant/DIB non triés";

/** Prix par défaut : 32 centimes d'euro le kilo. */
const DEFAULT_DIB_PRICE_CENTS_PER_KG = 32;

const SETTINGS_KEY = "bennespro";

type DepotItems = Array<{ material: string; unit: string; quantity: number }>;

/** Poids DIB facturable en kg (les lignes en m³ / unité ne sont pas facturables). */
function dibWeightKg(items: DepotItems): number {
  let kg = 0;
  for (const item of items) {
    if (item.material !== DIB_MATERIAL) continue;
    if (item.unit === "kg") kg += item.quantity;
    else if (item.unit === "tonne") kg += item.quantity * 1000;
  }
  return Math.round(kg * 100) / 100;
}

async function readDibPrice(ctx: QueryCtx | MutationCtx): Promise<number> {
  const settings = await ctx.db
    .query("bpSettings")
    .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
    .unique();
  return settings?.dibPriceCentsPerKg ?? DEFAULT_DIB_PRICE_CENTS_PER_KG;
}

export const getDibSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, "bennespro:depots", "read");
    return {
      priceCentsPerKg: await readDibPrice(ctx),
      stripeConfigured: Boolean(env.BENNESPRO_STRIPE_SECRET_KEY),
    };
  },
});

export const setDibPrice = mutation({
  args: { priceCentsPerKg: v.number() },
  handler: async (ctx, { priceCentsPerKg }) => {
    await requireCrmPermission(ctx, "bennespro:depots", "update");
    const identity = await requireUser(ctx);
    if (!Number.isFinite(priceCentsPerKg) || priceCentsPerKg <= 0 || priceCentsPerKg > 100000) {
      throw new Error("Prix DIB invalide.");
    }
    const rounded = Math.round(priceCentsPerKg * 100) / 100;
    const settings = await ctx.db
      .query("bpSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();
    if (settings) {
      await ctx.db.patch(settings._id, {
        dibPriceCentsPerKg: rounded,
        updatedAt: Date.now(),
        updatedBy: identity.email ?? undefined,
      });
    } else {
      await ctx.db.insert("bpSettings", {
        key: SETTINGS_KEY,
        dibPriceCentsPerKg: rounded,
        updatedAt: Date.now(),
        updatedBy: identity.email ?? undefined,
      });
    }
  },
});

/** (Re)facture le DIB d'un dépôt — utilisé pour les dépôts anciens ou en erreur. */
export const billDepot = mutation({
  args: { depotId: v.id("bpDepots") },
  handler: async (ctx, { depotId }) => {
    await requireCrmPermission(ctx, "bennespro:depots", "update");
    const depot = await ctx.db.get(depotId);
    if (!depot) throw new Error("Dépôt introuvable.");
    if (depot.billing?.status === "invoiced") {
      throw new Error("Ce dépôt est déjà facturé.");
    }
    const weightKg = dibWeightKg(depot.items);
    if (weightKg <= 0) {
      throw new Error("Aucun poids DIB facturable (kg ou tonne) sur ce dépôt.");
    }
    const priceCentsPerKg = await readDibPrice(ctx);
    const amountCents = Math.round(weightKg * priceCentsPerKg);
    await ctx.db.patch(depotId, {
      billing: { weightKg, priceCentsPerKg, amountCents, status: "pending" },
    });
    await ctx.scheduler.runAfter(0, internal.bennespro.invoiceDepotDib, { depotId });
  },
});

export const depotForBilling = internalQuery({
  args: { depotId: v.id("bpDepots") },
  handler: async (ctx, { depotId }) => {
    const depot = await ctx.db.get(depotId);
    if (!depot) return null;
    const company = await ctx.db.get(depot.companyId);
    return { depot, company };
  },
});

export const saveCompanyStripeCustomer = internalMutation({
  args: { companyId: v.id("bpCompanies"), stripeCustomerId: v.string() },
  handler: async (ctx, { companyId, stripeCustomerId }) => {
    await ctx.db.patch(companyId, { stripeCustomerId });
  },
});

export const saveDepotBilling = internalMutation({
  args: { depotId: v.id("bpDepots"), billing: bpBilling },
  handler: async (ctx, { depotId, billing }) => {
    await ctx.db.patch(depotId, { billing });
  },
});

async function stripeRequest(
  secretKey: string,
  path: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const json = (await res.json()) as {
    error?: { message?: string };
    [key: string]: unknown;
  };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Stripe ${path} a échoué (${res.status}).`);
  }
  return json;
}

/**
 * Facture le DIB d'un dépôt via Stripe : client (créé au besoin et mémorisé
 * sur l'entreprise), facture `send_invoice` à 30 jours, envoi par email si
 * l'entreprise a un email de contact.
 */
export const invoiceDepotDib = internalAction({
  args: { depotId: v.id("bpDepots") },
  handler: async (ctx, { depotId }) => {
    const data: { depot: Doc<"bpDepots">; company: Doc<"bpCompanies"> | null } | null =
      await ctx.runQuery(internal.bennespro.depotForBilling, { depotId });
    if (!data?.depot.billing || data.depot.billing.status === "invoiced") return;
    const { depot, company } = data;
    const billing: Infer<typeof bpBilling> = { ...depot.billing! };

    async function fail(message: string) {
      await ctx.runMutation(internal.bennespro.saveDepotBilling, {
        depotId,
        billing: { ...billing, status: "error", error: message },
      });
    }

    const secretKey = env.BENNESPRO_STRIPE_SECRET_KEY;
    if (!secretKey) {
      await fail("Clé Stripe non configurée (BENNESPRO_STRIPE_SECRET_KEY).");
      return;
    }
    if (!company) {
      await fail("Entreprise introuvable.");
      return;
    }

    try {
      // 1. Client Stripe de l'entreprise (créé une seule fois).
      let customerId = company.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeRequest(secretKey, "customers", {
          name: company.name,
          ...(company.contactEmail ? { email: company.contactEmail } : {}),
          ...(company.contactPhone ? { phone: company.contactPhone } : {}),
          "metadata[bpCompanyId]": company._id,
          ...(company.siret ? { "metadata[siret]": company.siret } : {}),
        });
        customerId = customer.id as string;
        await ctx.runMutation(internal.bennespro.saveCompanyStripeCustomer, {
          companyId: company._id,
          stripeCustomerId: customerId,
        });
      }

      const depotRef = `Bon de dépôt n° ${String(depot.depotNumber).padStart(4, "0")}`;

      // 2. Facture vide (paiement à réception, 30 jours).
      const invoice = await stripeRequest(secretKey, "invoices", {
        customer: customerId,
        collection_method: "send_invoice",
        days_until_due: "30",
        currency: "eur",
        description: depotRef,
        pending_invoice_items_behavior: "exclude",
        "metadata[bpDepotId]": depot._id,
        "metadata[bpDepotNumber]": String(depot.depotNumber),
      });
      const invoiceId = invoice.id as string;

      // 3. Ligne DIB.
      const priceEuros = (billing.priceCentsPerKg / 100).toFixed(2).replace(".", ",");
      await stripeRequest(secretKey, "invoiceitems", {
        customer: customerId,
        invoice: invoiceId,
        amount: String(billing.amountCents),
        currency: "eur",
        description: `DIB (tout-venant non trié) — ${billing.weightKg} kg × ${priceEuros} €/kg — ${depotRef}`,
      });

      // 4. Finalisation (+ envoi par email si possible).
      const finalized = await stripeRequest(secretKey, `invoices/${invoiceId}/finalize`, {
        auto_advance: "false",
      });
      if (company.contactEmail) {
        await stripeRequest(secretKey, `invoices/${invoiceId}/send`, {});
      }

      await ctx.runMutation(internal.bennespro.saveDepotBilling, {
        depotId,
        billing: {
          ...billing,
          status: "invoiced",
          stripeInvoiceId: invoiceId,
          stripeInvoiceUrl:
            (finalized.hosted_invoice_url as string | undefined) ?? undefined,
          error: undefined,
          invoicedAt: Date.now(),
        },
      });
    } catch (err) {
      await fail(err instanceof Error ? err.message : "Erreur Stripe inconnue.");
    }
  },
});

/** Envoie le lien de la facture Stripe par email à l'entreprise du dépôt. */
export const sendInvoiceEmail = action({
  args: { depotId: v.id("bpDepots") },
  handler: async (ctx, { depotId }): Promise<{ sentTo: string }> => {
    // Annotations explicites : évite la circularité de types (fonction du même module).
    const access: {
      isAdmin?: boolean;
      bootstrapMode?: boolean;
      grants: Array<{ pageKey: string; actions: string[] }>;
    } = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, "bennespro:depots", "read")) {
      throw new Error("Accès insuffisant.");
    }
    const data: { depot: Doc<"bpDepots">; company: Doc<"bpCompanies"> | null } | null =
      await ctx.runQuery(internal.bennespro.depotForBilling, { depotId });
    if (!data) throw new Error("Dépôt introuvable.");
    const { depot, company } = data;
    if (!depot.billing?.stripeInvoiceUrl) {
      throw new Error("Aucune facture Stripe pour ce dépôt.");
    }
    const email = company?.contactEmail?.trim();
    if (!email) {
      throw new Error("Cette entreprise n'a pas d'email de contact. Ajoutez-le dans sa fiche.");
    }

    const ref = `Bon de dépôt n° ${String(depot.depotNumber).padStart(4, "0")}`;
    const amount = (depot.billing.amountCents / 100).toFixed(2).replace(".", ",");
    const date = new Date(depot.createdAt).toLocaleDateString("fr-FR");
    const html = `<!doctype html>
<html lang="fr"><body style="margin:0;background:#f4f7f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8e4;">
      <tr><td style="background:#14332f;padding:20px 28px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:bold;">Déchet'Lab — Bennes &amp; Pro</p>
      </td></tr>
      <tr><td style="padding:28px;">
        <p style="margin:0 0 12px;font-size:15px;color:#1c2422;">Bonjour${company?.contactName ? ` ${company.contactName}` : ""},</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#3d4a46;">
          Veuillez trouver ci-dessous votre facture pour le dépôt de déchets
          <strong>${ref}</strong> du ${date} (DIB : ${depot.billing.weightKg}&nbsp;kg — <strong>${amount}&nbsp;€</strong>).
        </p>
        <p style="margin:0 0 24px;">
          <a href="${depot.billing.stripeInvoiceUrl}" style="display:inline-block;background:#2aa79b;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:8px;">
            Voir et régler la facture
          </a>
        </p>
        <p style="margin:0;font-size:12px;line-height:18px;color:#8a9691;">
          Le paiement s'effectue en ligne de façon sécurisée via Stripe.
          Message automatique — merci de ne pas répondre à cet email.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

    await resendSend(
      email,
      `Votre facture — ${ref} (${amount} €)`,
      html,
      "Déchet'Lab <no-reply@mesoutils.eco-solidaire.fr>",
    );
    return { sentTo: email };
  },
});

/* ─── Maintenance (CLI uniquement) ────────────────────────────────────────── */

/** Force le prix DIB (centimes/kg) — `npx convex run bennespro:adminSetDibPrice '{"priceCentsPerKg":32}'`. */
export const adminSetDibPrice = internalMutation({
  args: { priceCentsPerKg: v.number() },
  handler: async (ctx, { priceCentsPerKg }) => {
    const settings = await ctx.db
      .query("bpSettings")
      .withIndex("by_key", (q) => q.eq("key", SETTINGS_KEY))
      .unique();
    if (settings) {
      await ctx.db.patch(settings._id, { dibPriceCentsPerKg: priceCentsPerKg, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("bpSettings", {
        key: SETTINGS_KEY,
        dibPriceCentsPerKg: priceCentsPerKg,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Supprime un dépôt (fichiers inclus) et, au besoin, son entreprise + véhicules. */
export const adminWipeDepot = internalMutation({
  args: { depotId: v.id("bpDepots"), alsoCompany: v.optional(v.boolean()) },
  handler: async (ctx, { depotId, alsoCompany }) => {
    const depot = await ctx.db.get(depotId);
    if (!depot) return;
    const files = [
      depot.ticketPhoto,
      depot.truckExteriorPhoto,
      depot.truckInteriorPhoto,
      depot.signature,
      ...depot.attachments,
    ].filter((id): id is Id<"_storage"> => Boolean(id));
    for (const fileId of files) {
      try {
        await ctx.storage.delete(fileId);
      } catch {
        // Fichier déjà absent.
      }
    }
    await ctx.db.delete(depotId);
    if (alsoCompany) {
      const vehicles = await ctx.db
        .query("bpVehicles")
        .withIndex("by_company", (q) => q.eq("companyId", depot.companyId))
        .collect();
      for (const vehicle of vehicles) await ctx.db.delete(vehicle._id);
      const company = await ctx.db.get(depot.companyId);
      if (company) await ctx.db.delete(company._id);
    }
  },
});

/**
 * Supprime un dépôt de test : annule (void) la facture Stripe si elle existe,
 * puis efface le dépôt (et l'entreprise si demandé).
 * `npx convex run bennespro:adminDeleteTestDepot '{"depotId":"…","alsoCompany":true}'`
 */
export const adminDeleteTestDepot = internalAction({
  args: { depotId: v.id("bpDepots"), alsoCompany: v.optional(v.boolean()) },
  handler: async (ctx, { depotId, alsoCompany }): Promise<{ voided: boolean; deleted: boolean }> => {
    const data: { depot: Doc<"bpDepots">; company: Doc<"bpCompanies"> | null } | null =
      await ctx.runQuery(internal.bennespro.depotForBilling, { depotId });
    if (!data) return { voided: false, deleted: false };

    let voided = false;
    const invoiceId = data.depot.billing?.stripeInvoiceId;
    const secretKey = env.BENNESPRO_STRIPE_SECRET_KEY;
    if (invoiceId && secretKey) {
      try {
        await stripeRequest(secretKey, `invoices/${invoiceId}/void`, {});
        voided = true;
      } catch (err) {
        console.warn("Impossible d'annuler la facture Stripe :", err);
      }
    }
    await ctx.runMutation(internal.bennespro.adminWipeDepot, { depotId, alsoCompany });
    return { voided, deleted: true };
  },
});
