import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const page = internalQuery({
  args: { id: v.id("bpMonthlyInvoices"), offset: v.number() },
  handler: async (ctx, { id, offset }) => {
    const batch = await ctx.db.get(id);
    if (!batch?.stripeInvoiceId || batch.status === "canceled") throw new Error("Facture groupée indisponible.");
    const company = await ctx.db.get(batch.companyId);
    if (!company) throw new Error("Entreprise introuvable.");
    const excluded = new Set(batch.sources?.filter(s => s.outcome === "excluded").flatMap(s => s.depotIds) ?? []);
    const ids = batch.depotIds.filter(id => !excluded.has(id));
    const depots = await Promise.all(ids.slice(offset, offset + 10).map(async depotId => {
      const depot = await ctx.db.get(depotId);
      if (!depot || depot.companyId !== batch.companyId) throw new Error("Bon de dépôt manquant : envoi interrompu.");
      return { depot, vehicle: await ctx.db.get(depot.vehicleId) };
    }));
    return { batch, company, depots, total: ids.length };
  },
});

export const initialize = internalMutation({
  args: { id: v.id("bpMonthlyInvoices"), email: v.string() },
  handler: async (ctx, { id, email }) => {
    const batch = await ctx.db.get(id);
    if (!batch) throw new Error("Facture introuvable.");
    const recipient = batch.receiptRecipient ?? email;
    if (!recipient.trim()) throw new Error("Email de facturation manquant.");
    if (!batch.receiptRecipient) await ctx.db.patch(id, { receiptRecipient: recipient });
    return { recipient, sent: batch.receiptPartsSent ?? [] };
  },
});

export const markSent = internalMutation({
  args: { id: v.id("bpMonthlyInvoices"), part: v.number() },
  handler: async (ctx, { id, part }) => {
    const batch = await ctx.db.get(id);
    if (!batch) throw new Error("Facture introuvable.");
    await ctx.db.patch(id, { receiptPartsSent: [...new Set([...(batch.receiptPartsSent ?? []), part])] });
  },
});
