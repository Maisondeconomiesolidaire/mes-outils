/**
 * Envoi automatique de NOS factures Bâtire (HT / TTC) après un paiement par
 * carte : le PDF est construit côté serveur avec le même code que le CRM et
 * part au client dans un seul e-mail par commande.
 */
import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { buildBillingPdf, ISSUERS, euros } from "./lib/batireBillingPdf";
import { bytesToBase64 } from "./emails";
import { sendOrderInvoicesMail } from "./batireEmails";

export const invoicesForOrders = internalQuery({
  args: { orderIds: v.array(v.id("btOrders")) },
  handler: async (ctx, { orderIds }) => {
    const docs: Doc<"btBillingDocs">[] = [];
    for (const orderId of orderIds) {
      const invoice = (await ctx.db.query("btBillingDocs").withIndex("by_orderId", q => q.eq("orderId", orderId)).collect()).find(doc => doc.type === "facture");
      if (invoice) docs.push(invoice);
    }
    return docs;
  },
});

export const emailOrderInvoices = internalAction({
  args: { orderIds: v.array(v.id("btOrders")) },
  handler: async (ctx, { orderIds }) => {
    const docs = (await ctx.runQuery(internal.batireInvoiceMail.invoicesForOrders, { orderIds })).filter(doc => !doc.sentAt);
    const to = docs.find(doc => doc.client.email)?.client.email?.trim().toLowerCase();
    if (!docs.length || !to) return;
    const files = [];
    for (const doc of docs) {
      const bytes = await buildBillingPdf({ ...doc, client: doc.client });
      files.push({ number: doc.number, issuerName: ISSUERS[doc.issuer].name, total: euros(doc.totalCents), pdfBase64: bytesToBase64(bytes) });
    }
    const first = docs[0]!.client;
    const name = first.company ? "" : [first.firstName, first.lastName].filter(Boolean).join(" ");
    const ok = await sendOrderInvoicesMail({ to, name, files });
    if (!ok) throw new Error("Envoi de la facture impossible (Resend).");
    for (const doc of docs) await ctx.runMutation(internal.batire.markBillingDocSent, { id: doc._id, to });
  },
});
