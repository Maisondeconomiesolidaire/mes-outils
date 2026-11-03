import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";
import { canGroupDeposit, depositInvoiceDetails } from "./lib/bpMonthlyBilling";
import { stripeGet, stripeRequest } from "./bennespro";

export const create = mutation({
  args: { companyId: v.id("bpCompanies"), depotIds: v.array(v.id("bpDepots")) },
  handler: async (ctx, { companyId, depotIds }) => {
    await requireCrmPermission(ctx, "bennespro:depots", "update");
    const ids = [...new Set(depotIds)];
    if (ids.length < 2 || ids.length > 250) throw new Error("Sélectionnez entre 2 et 250 dépôts.");
    const company = await ctx.db.get(companyId);
    if (!company || !(company.billingEmail?.trim() || company.contactEmail?.trim())) throw new Error("Renseignez l'email de facturation de l'entreprise.");
    const all = await ctx.db.query("bpDepots").withIndex("by_company", q => q.eq("companyId", companyId)).collect();
    const selected = new Set(ids);
    const depots = all.filter(d => selected.has(d._id));
    if (depots.length !== ids.length || depots.some(d => !canGroupDeposit(d))) throw new Error("La sélection contient un dépôt non éligible, réglé, annulé ou déjà en cours de regroupement.");
    const sourceIds = [...new Set(depots.flatMap(d => d.billing?.stripeInvoiceId ? [d.billing.stripeInvoiceId] : []))];
    // A Stripe invoice is indivisible: never void it for a partial selection.
    for (const invoiceId of sourceIds) {
      if (all.some(d => d.billing?.stripeInvoiceId === invoiceId && !selected.has(d._id))) throw new Error("Sélectionnez tous les dépôts de chaque facture déjà groupée.");
    }
    const details = depositInvoiceDetails(depots);
    const sources = sourceIds.map(invoiceId => {
      const entries = depots.filter(d => d.billing!.stripeInvoiceId === invoiceId);
      return { invoiceId, depotIds: entries.map(d => d._id), amountCents: entries.reduce((sum, d) => sum + d.billing!.amountCents, 0) };
    });
    const id = await ctx.db.insert("bpMonthlyInvoices", {
      kind: "manual", companyId, month: `manual:${Date.now()}`, depotIds: ids,
      lines: [], details, sources, status: "pending", leaseUntil: 0,
    });
    for (const d of depots) await ctx.db.patch(d._id, { billing: { ...d.billing!, groupingId: id } });
    await ctx.scheduler.runAfter(0, internal.bennesproMonthly.processManual, { id });
    return id;
  },
});

export const list = query({
  args: { companyId: v.id("bpCompanies") },
  handler: async (ctx, { companyId }) => {
    await requireCrmPermission(ctx, "bennespro:depots", "read");
    const batches = await ctx.db.query("bpMonthlyInvoices").withIndex("by_company", q => q.eq("companyId", companyId)).order("desc").take(20);
    return batches.map(b => ({
      _id: b._id, kind: b.kind, status: b.status, error: b.error, leaseUntil: b.leaseUntil,
      count: b.details?.length ?? b.depotIds.length, stripeInvoiceUrl: b.stripeInvoiceUrl,
      excluded: b.sources?.filter(s => s.outcome === "excluded").map(s => ({ invoiceId: s.invoiceId, reason: s.reason })) ?? [],
    }));
  },
});

export const retry = mutation({
  args: { id: v.id("bpMonthlyInvoices") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, "bennespro:depots", "update");
    const b = await ctx.db.get(id);
    if (!b || b.kind !== "manual" || b.status !== "pending") throw new Error("Regroupement non disponible.");
    if (b.leaseUntil > Date.now()) throw new Error("Le regroupement est déjà en cours.");
    await ctx.scheduler.runAfter(0, internal.bennesproMonthly.processManual, { id });
  },
});

export const recover = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("bpMonthlyInvoices").withIndex("by_status", q => q.eq("status", "pending")).paginate({ numItems: 100, cursor: cursor ?? null });
    for (const batch of page.page) {
      if (batch.kind === "manual" && batch.leaseUntil <= Date.now()) await ctx.scheduler.runAfter(0, internal.bennesproMonthly.processManual, { id: batch._id });
    }
    if (!page.isDone) await ctx.scheduler.runAfter(0, internal.bennesproGrouping.recover, { cursor: page.continueCursor });
  },
});

export const claim = internalMutation({
  args: { id: v.id("bpMonthlyInvoices") },
  handler: async (ctx, { id }) => {
    const batch = await ctx.db.get(id);
    if (!batch || batch.kind !== "manual" || batch.status !== "pending" || batch.leaseUntil > Date.now()) return null;
    const company = await ctx.db.get(batch.companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    await ctx.db.patch(id, { leaseUntil: Date.now() + 15 * 60_000, error: undefined });
    return { batch, company };
  },
});

export const get = internalQuery({
  args: { id: v.id("bpMonthlyInvoices") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const recordSource = internalMutation({
  args: {
    id: v.id("bpMonthlyInvoices"), invoiceId: v.string(),
    outcome: v.union(v.literal("voided"), v.literal("excluded")),
    paymentStatus: v.union(v.literal("open"), v.literal("paid"), v.literal("void"), v.literal("uncollectible"), v.literal("draft")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.id);
    const source = batch?.sources?.find(s => s.invoiceId === args.invoiceId);
    if (!batch || !source) throw new Error("Facture d'origine introuvable.");
    await ctx.db.patch(batch._id, { sources: batch.sources!.map(s => s.invoiceId === args.invoiceId ? { ...s, outcome: args.outcome, reason: args.reason } : s) });
    for (const id of source.depotIds) {
      const depot = await ctx.db.get(id);
      if (!depot?.billing || depot.billing.groupingId !== batch._id) throw new Error("Verrou de regroupement manquant.");
      await ctx.db.patch(id, { billing: {
        ...depot.billing, paymentStatus: args.paymentStatus,
        ...(args.outcome === "excluded" ? { groupingId: undefined } : {}),
      } });
    }
  },
});

type Source = NonNullable<Doc<"bpMonthlyInvoices">["sources"]>[number];

function sourceDisposition(invoice: Record<string, unknown>, source: Source, batchId: string) {
  const metadata = invoice.metadata as Record<string, string> | undefined;
  if (invoice.status === "void" && metadata?.bpReplacementBatch === batchId) return "voided";
  if (invoice.status !== "open" || invoice.amount_paid !== 0 || invoice.amount_remaining !== invoice.total) return "excluded";
  const subtotal = invoice.subtotal_excluding_tax ?? invoice.subtotal;
  if (invoice.currency !== "eur" || subtotal !== source.amountCents || (invoice.pre_payment_credit_notes_amount as number ?? 0) > 0 || (invoice.post_payment_credit_notes_amount as number ?? 0) > 0 || (Array.isArray(invoice.total_discount_amounts) && invoice.total_discount_amounts.length > 0)) {
    throw new Error(`La facture ${source.invoiceId} comporte un montant, une remise ou un avoir différent des dépôts. Aucun remplacement automatique possible.`);
  }
  return "open";
}

/** Preflight every original before modifying any: stale local status is not trusted. */
export async function checkSources(secret: string, batch: Doc<"bpMonthlyInvoices">) {
  for (const source of batch.sources ?? []) {
    if (source.outcome) continue;
    sourceDisposition(await stripeGet(secret, `invoices/${source.invoiceId}`), source, batch._id);
  }
}

/** Voids only unpaid originals. A race with a payment excludes that invoice.
 * The replacement remains a draft until every original has a durable outcome. */
export async function replaceSources(ctx: Pick<ActionCtx, "runMutation" | "runQuery">, secret: string, batch: Doc<"bpMonthlyInvoices">) {
  for (const source of batch.sources ?? []) {
    if (source.outcome) continue;
    let invoice = await stripeGet(secret, `invoices/${source.invoiceId}`);
    let disposition = sourceDisposition(invoice, source, batch._id);
    if (disposition === "open") {
      await stripeRequest(secret, `invoices/${source.invoiceId}`, { "metadata[bpReplacementBatch]": batch._id, "metadata[bpReplacementInvoice]": batch.stripeInvoiceId! });
      // Re-read after the metadata update; Stripe rejects void if payment wins.
      invoice = await stripeGet(secret, `invoices/${source.invoiceId}`);
      disposition = sourceDisposition(invoice, source, batch._id);
      if (disposition === "open") {
        try {
          invoice = await stripeRequest(secret, `invoices/${source.invoiceId}/void`, {}, `bp-group-${batch._id}-void-${source.invoiceId}`);
        } catch (error) {
          invoice = await stripeGet(secret, `invoices/${source.invoiceId}`);
          if (sourceDisposition(invoice, source, batch._id) === "open") throw error;
        }
        disposition = sourceDisposition(invoice, source, batch._id);
        if (disposition === "open") throw new Error("Annulation Stripe non confirmée.");
      }
    }
    const status = invoice.status;
    if (status !== "open" && status !== "paid" && status !== "void" && status !== "uncollectible" && status !== "draft") throw new Error("Statut Stripe inconnu.");
    await ctx.runMutation(internal.bennesproGrouping.recordSource, {
      id: batch._id, invoiceId: source.invoiceId, outcome: disposition === "voided" ? "voided" : "excluded",
      paymentStatus: status,
      ...(disposition === "excluded" ? { reason: status === "open" ? "Règlement partiel ou solde ajusté : non regroupée." : `Statut Stripe ${status} : non regroupée.` } : {}),
    });
  }
  return (await ctx.runQuery(internal.bennesproGrouping.get, { id: batch._id })) as Doc<"bpMonthlyInvoices">;
}
