import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { aggregateBillingLines, billingMonth } from "./lib/bpMonthlyBilling";
import { stripeGet, stripeRequest, stripeVatTaxRateId } from "./bennespro";

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
    for (const d of result.page) groups.set(`${d.companyId}:${d.billing!.month}`, { companyId: d.companyId, month: d.billing!.month! });
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
      const depots = all.filter(d => d.billing?.status === "pending" && !d.billing.stripeInvoiceId && !d.billing.monthlyInvoiceId);
      if (!depots.length) return null;
      const lines = aggregateBillingLines(depots.flatMap(d => d.billing!.items ?? []));
      if (!lines.length) throw new Error("Aucune ligne facturable.");
      const id = await ctx.db.insert("bpMonthlyInvoices", { companyId, month, depotIds: depots.map(d => d._id), lines, status: "pending", leaseUntil: 0 });
      for (const d of depots) await ctx.db.patch(d._id, { billing: { ...d.billing!, monthlyInvoiceId: id } });
      batch = (await ctx.db.get(id))!;
    }
    if (batch.status === "sent" || batch.leaseUntil > Date.now()) return null;
    const leaseUntil = Date.now() + 15 * 60_000;
    await ctx.db.patch(batch._id, { leaseUntil });
    return { batch, company };
  },
});

export const saveProgress = internalMutation({
  args: { id: v.id("bpMonthlyInvoices"), invoiceId: v.optional(v.string()), error: v.optional(v.string()), sent: v.optional(v.boolean()), paid: v.optional(v.boolean()), url: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.id);
    if (!batch) throw new Error("Facture mensuelle introuvable.");
    if (args.invoiceId) await ctx.db.patch(batch._id, { stripeInvoiceId: args.invoiceId });
    if (args.error) await ctx.db.patch(batch._id, { error: args.error, leaseUntil: 0 });
    if (args.sent) {
      const invoiceId = args.invoiceId ?? batch.stripeInvoiceId;
      if (!invoiceId) throw new Error("Facture Stripe manquante.");
      for (const id of batch.depotIds) {
        const depot = await ctx.db.get(id);
        if (!depot?.billing) throw new Error("Dépôt facturé manquant.");
        await ctx.db.patch(id, { billing: { ...depot.billing, status: "invoiced", stripeInvoiceId: invoiceId, stripeInvoiceUrl: args.url, invoicedAt: Date.now(), paymentStatus: args.paid ? "paid" : "open", error: undefined } });
      }
      await ctx.db.patch(batch._id, { status: "sent", sentAt: Date.now(), leaseUntil: 0, error: undefined });
    }
  },
});

export const process = internalAction({
  args: { companyId: v.id("bpCompanies"), month: v.string() },
  handler: async (ctx, args) => {
    const claimed: { batch: Doc<"bpMonthlyInvoices">; company: Doc<"bpCompanies"> } | null = await ctx.runMutation(internal.bennesproMonthly.claim, args);
    if (!claimed) return;
    const { batch, company } = claimed;
    const key = `bp-monthly-${batch._id}`;
    try {
      const secret = env.BENNESPRO_STRIPE_SECRET_KEY;
      if (!secret) throw new Error("Clé Stripe non configurée.");
      const email = company.billingEmail?.trim() || company.contactEmail?.trim();
      if (!email) throw new Error("Adresse email de facturation manquante.");
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
          description: `Dépôts DIB / Bois — ${batch.month} — ${batch.depotIds.length} dépôt(s)`,
          "metadata[bpMonthlyInvoiceId]": batch._id, "metadata[bpCompanyId]": company._id,
        }, `${key}-invoice`);
        invoiceId = String(invoice.id);
      }
      await ctx.runMutation(internal.bennesproMonthly.saveProgress, { id: batch._id, invoiceId });
      let invoice = await stripeGet(secret, `invoices/${invoiceId}`);
      if (invoice.status === "draft") {
        const taxRate = await stripeVatTaxRateId(secret);
        const existing = await stripeGet(secret, `invoices/${invoiceId}/lines?limit=100`);
        const lines = existing.data as Array<{ metadata?: { bpMonthlyMaterial?: string } }>;
        for (const [index, line] of batch.lines.entries()) {
          if (lines.some(l => l.metadata?.bpMonthlyMaterial === line.material)) continue;
          await stripeRequest(secret, "invoiceitems", {
            customer: customerId, invoice: invoiceId, currency: "eur", amount: String(line.amountCents),
            "tax_rates[0]": taxRate, "metadata[bpMonthlyMaterial]": line.material,
            description: `${line.material} — ${line.weightKg} kg — dépôts du mois ${batch.month}`,
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
  },
});
