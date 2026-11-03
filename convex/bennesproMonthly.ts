import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { aggregateBillingLines, billingMonth, depositInvoiceDetails, stripeDetailLines } from "./lib/bpMonthlyBilling";
import { StripeApiError, stripeGet, stripeRequest, stripeVatTaxRateId } from "./bennespro";
import { checkSources, replaceSources } from "./bennesproGrouping";

/** Read-only deployment check: never exposes credentials or customer data. */
export const configuration = internalQuery({
  args: {},
  handler: () => ({
    month: billingMonth(Date.now()),
    timeZone: "Europe/Paris",
    stripeConfigured: Boolean(env.BENNESPRO_STRIPE_SECRET_KEY),
    stripeLiveMode: /^(sk|rk)_live_/.test(env.BENNESPRO_STRIPE_SECRET_KEY ?? ""),
  }),
});

// Runs on the first, then retries incomplete invoices hourly. No Stripe call
// happens while deposits are recorded, and historical invoices are excluded.
export const enqueue = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const month = billingMonth(Date.now());
    const result = await ctx.db.query("bpDepots")
      .withIndex("by_monthly_pending", q => q.eq("billing.status", "pending").gt("billing.month", "").lt("billing.month", month))
      .paginate({ numItems: 100, cursor: cursor ?? null });
    const groups = new Map<string, { companyId: Id<"bpCompanies">; month: string }>();
    for (const d of result.page.filter(d => !d.billing?.groupingId)) groups.set(`${d.companyId}:${d.billing!.month}`, { companyId: d.companyId, month: d.billing!.month! });
    for (const group of groups.values()) await ctx.scheduler.runAfter(0, internal.bennesproMonthly.process, group);
    if (!result.isDone) await ctx.scheduler.runAfter(0, internal.bennesproMonthly.enqueue, { cursor: result.continueCursor });
  },
});

export const claim = internalMutation({
  args: { companyId: v.id("bpCompanies"), month: v.string() },
  handler: async (ctx, { companyId, month }) => {
    if (month >= billingMonth(Date.now())) return null;
    const company = await ctx.db.get(companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    let batch = await ctx.db.query("bpMonthlyInvoices").withIndex("by_company_month", q => q.eq("companyId", companyId).eq("month", month)).unique();
    if (!batch) {
      const all = await ctx.db.query("bpDepots").withIndex("by_company_month", q => q.eq("companyId", companyId).eq("billing.month", month)).take(1001);
      if (all.length > 1000) throw new Error("Plus de 1000 dépôts sur le mois : traitement manuel requis.");
      const depots = all.filter(d => d.billing?.status === "pending" && !d.billing.stripeInvoiceId && !d.billing.monthlyInvoiceId && !d.billing.groupingId);
      if (!depots.length) return null;
      const lines = aggregateBillingLines(depots.flatMap(d => d.billing!.items ?? []));
      if (!lines.length) throw new Error("Aucune ligne facturable.");
      const details = depositInvoiceDetails(depots);
      const id = await ctx.db.insert("bpMonthlyInvoices", { kind: "monthly", details, companyId, month, depotIds: depots.map(d => d._id), lines, status: "pending", leaseUntil: 0 });
      for (const d of depots) await ctx.db.patch(d._id, { billing: { ...d.billing!, monthlyInvoiceId: id } });
      batch = (await ctx.db.get(id))!;
    }
    if (batch.status !== "pending" || batch.leaseUntil > Date.now()) return null;
    const leaseUntil = Date.now() + 15 * 60_000;
    await ctx.db.patch(batch._id, { leaseUntil });
    return { batch, company };
  },
});

export const saveProgress = internalMutation({
  args: { id: v.id("bpMonthlyInvoices"), invoiceId: v.optional(v.string()), error: v.optional(v.string()), sent: v.optional(v.boolean()), paid: v.optional(v.boolean()), canceled: v.optional(v.boolean()), url: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.id);
    if (!batch) throw new Error("Facture mensuelle introuvable.");
    if (args.invoiceId) await ctx.db.patch(batch._id, { stripeInvoiceId: args.invoiceId });
    if (args.error) await ctx.db.patch(batch._id, { error: args.error, leaseUntil: 0 });
    if (args.canceled) {
      await ctx.db.patch(batch._id, { status: "canceled", leaseUntil: 0, error: "Aucune facture impayée éligible après vérification Stripe." });
      for (const id of batch.depotIds) {
        const d = await ctx.db.get(id);
        if (d?.billing?.groupingId === batch._id) await ctx.db.patch(id, { billing: { ...d.billing, groupingId: undefined } });
      }
    }
    if (args.sent) {
      const invoiceId = args.invoiceId ?? batch.stripeInvoiceId;
      if (!invoiceId) throw new Error("Facture Stripe manquante.");
      const excluded = new Set(batch.sources?.filter(s => s.outcome === "excluded").flatMap(s => s.depotIds) ?? []);
      for (const id of batch.depotIds.filter(id => !excluded.has(id))) {
        const depot = await ctx.db.get(id);
        if (!depot?.billing) throw new Error("Dépôt facturé manquant.");
        await ctx.db.patch(id, { billing: { ...depot.billing, monthlyInvoiceId: batch._id, groupingId: undefined,
          replacedStripeInvoiceIds: [...new Set([...(depot.billing.replacedStripeInvoiceIds ?? []), ...(batch.sources?.filter(s => s.outcome === "voided" && s.depotIds.includes(id)).map(s => s.invoiceId) ?? [])])],
          status: "invoiced", stripeInvoiceId: invoiceId, stripeInvoiceUrl: args.url, invoicedAt: Date.now(), paymentStatus: args.paid ? "paid" : "open", error: undefined } });
      }
      await ctx.db.patch(batch._id, { status: "sent", depotIds: batch.depotIds.filter(id => !excluded.has(id)), stripeInvoiceUrl: args.url, sentAt: Date.now(), leaseUntil: 0, error: undefined });
    }
  },
});

export const process = internalAction({
  args: { companyId: v.id("bpCompanies"), month: v.string() },
  handler: async (ctx, args) => {
    const claimed: { batch: Doc<"bpMonthlyInvoices">; company: Doc<"bpCompanies"> } | null = await ctx.runMutation(internal.bennesproMonthly.claim, args);
    if (!claimed) return;
    await runBatch(ctx, claimed);
  },
});

export const processManual = internalAction({
  args: { id: v.id("bpMonthlyInvoices") },
  handler: async (ctx, args) => {
    const claimed: { batch: Doc<"bpMonthlyInvoices">; company: Doc<"bpCompanies"> } | null = await ctx.runMutation(internal.bennesproGrouping.claim, args);
    if (claimed) await runBatch(ctx, claimed);
  },
});

async function runBatch(ctx: ActionCtx, claimed: { batch: Doc<"bpMonthlyInvoices">; company: Doc<"bpCompanies"> }) {
  let { batch } = claimed;
  const { company } = claimed;

  const key = `bp-monthly-${batch._id}`;
  try {
    const secret = env.BENNESPRO_STRIPE_SECRET_KEY;
    if (!secret) throw new Error("Clé Stripe non configurée.");
    const email = company.billingEmail?.trim() || company.contactEmail?.trim();
    if (!email) throw new Error("Adresse email de facturation manquante.");
    if (batch.details?.some(d => d.vatRate !== 20)) throw new Error("Le regroupement automatique nécessite une TVA de 20 % sur tous les dépôts.");
    await checkSources(secret, batch);
    let customerId = company.stripeCustomerId;
    if (!customerId) {
      const matches = await stripeGet(secret, `customers?email=${encodeURIComponent(email)}&limit=100`);
      const match = (matches.data as Array<{ id: string; metadata?: { bpCompanyId?: string } }>).find(c => c.metadata?.bpCompanyId === company._id);
      customerId = match?.id;
    }
    if (!customerId) {
      const customer = await stripeRequest(secret, "customers", { name: company.name, email, "metadata[bpCompanyId]": company._id }, `bp-company-${company._id}`);
      customerId = String(customer.id);
    }
    await ctx.runMutation(internal.bennespro.saveCompanyStripeCustomer, { companyId: company._id, stripeCustomerId: customerId });
    await stripeRequest(secret, `customers/${customerId}`, { email });

    // Recover a response lost before the Convex checkpoint, even after Stripe's
    // idempotency-key retention window. Page through this customer's invoices.
    let invoiceId = batch.stripeInvoiceId;
    if (!invoiceId) {
      let after = "";
      while (true) {
        const result = await stripeGet(secret, `invoices?customer=${customerId}&limit=100${after}`);
        const invoices = result.data as Array<{ id: string; metadata?: { bpMonthlyInvoiceId?: string } }>;
        invoiceId = invoices.find(i => i.metadata?.bpMonthlyInvoiceId === batch._id)?.id;
        if (invoiceId || !result.has_more) break;
        after = `&starting_after=${invoices[invoices.length - 1].id}`;
      }
    }
    if (!invoiceId) {
      const invoice = await stripeRequest(secret, "invoices", {
        customer: customerId, collection_method: "send_invoice", days_until_due: "30", currency: "eur",
        auto_advance: "false", pending_invoice_items_behavior: "exclude",
        description: `Dépôts DIB / Bois — ${batch.kind === "manual" ? "Regroupement" : batch.month} — ${batch.depotIds.length} dépôt(s)`,
        "metadata[bpMonthlyInvoiceId]": batch._id, "metadata[bpCompanyId]": company._id,
      }, `${key}-invoice`);
      invoiceId = String(invoice.id);
    }
    await ctx.runMutation(internal.bennesproMonthly.saveProgress, { id: batch._id, invoiceId });
    batch = { ...batch, stripeInvoiceId: invoiceId };
    if (batch.kind === "manual") batch = await replaceSources(ctx, secret, batch);
    const excluded = new Set(batch.sources?.filter(s => s.outcome === "excluded").flatMap(s => s.depotIds) ?? []);
    const details = batch.details?.filter(d => !excluded.has(d.depotId));
    let invoice: Record<string, unknown>;
    try {
      invoice = await stripeGet(secret, `invoices/${invoiceId}`);
    } catch (error) {
      if (details?.length === 0 && error instanceof StripeApiError && error.status === 404) {
        await ctx.runMutation(internal.bennesproMonthly.saveProgress, { id: batch._id, canceled: true });
        return;
      }
      throw error;
    }
    if (details && details.length === 0) {
      if (invoice.status !== "draft") throw new Error("Facture vide déjà finalisée : vérification manuelle requise.");
      await stripeRequest(secret, `invoices/${invoiceId}`, {}, `${key}-delete-empty`, "DELETE");
      await ctx.runMutation(internal.bennesproMonthly.saveProgress, { id: batch._id, canceled: true });
      return;
    }
    if (invoice.status === "draft") {
      if (details) await stripeRequest(secret, `invoices/${invoiceId}`, {
        description: `Dépôts DIB / Bois — ${batch.kind === "manual" ? "Regroupement" : batch.month} — ${details.length} dépôt(s)`,
      });
      const taxRate = await stripeVatTaxRateId(secret);
      const existingKeys = new Set<string>();
      let after = "";
      do {
        const page = await stripeGet(secret, `invoices/${invoiceId}/lines?limit=100${after}`);
        const lines = page.data as Array<{ id: string; metadata?: Record<string, string> }>;
        for (const line of lines) {
          const lineKey = line.metadata?.bpDetailKey ?? line.metadata?.bpMonthlyMaterial;
          if (lineKey) existingKeys.add(lineKey);
        }
        after = page.has_more ? `&starting_after=${lines[lines.length - 1].id}` : "";
      } while (after);
      // Legacy unfinished batches retain their frozen aggregate lines. All new
      // monthly and manual batches carry an immutable detail for every deposit.
      const invoiceLines = (details ? stripeDetailLines(details) : undefined)
        ?? batch.lines.map(l => ({ key: l.material, amountCents: l.amountCents, description: `${l.material} — ${l.weightKg} kg — dépôts du mois ${batch.month}` }));
      for (const [index, line] of invoiceLines.entries()) {
        if (existingKeys.has(line.key)) continue;
        await stripeRequest(secret, "invoiceitems", {
          customer: customerId, invoice: invoiceId, currency: "eur", amount: String(line.amountCents), discountable: "false",
          "tax_rates[0]": taxRate, "metadata[bpDetailKey]": line.key,
          description: line.description,
        }, `${key}-line-${index}`);
      }
      invoice = await stripeRequest(secret, `invoices/${invoiceId}/finalize`, { auto_advance: "false" }, `${key}-finalize`);
    }
    if (invoice.status !== "open" && invoice.status !== "paid") throw new Error(`Statut Stripe inattendu : ${invoice.status}`);
    const metadata = invoice.metadata as Record<string, string> | undefined;
    if (metadata?.bpMonthlySent !== "true") {
      await stripeRequest(secret, `invoices/${invoiceId}/send`, {}, `${key}-send`);
      await stripeRequest(secret, `invoices/${invoiceId}`, { "metadata[bpMonthlySent]": "true" });
    }
    await ctx.runMutation(internal.bennesproMonthly.saveProgress, { id: batch._id, sent: true, paid: invoice.status === "paid", url: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : undefined });
  } catch (error) {
    await ctx.runMutation(internal.bennesproMonthly.saveProgress, { id: batch._id, error: error instanceof Error ? error.message : String(error) });
    console.error("Facturation mensuelle", batch._id, error);
  }
}
