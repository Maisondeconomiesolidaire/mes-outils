"use node";
import { setTimeout as delay } from "node:timers/promises";
import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildReceiptPdf } from "./lib/bpReceiptPdf";
import { bytesToBase64, resendSend, type EmailAttachment } from "./emails";
import { stripeGet } from "./bennespro";

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const send = internalAction({
  args: { id: v.id("bpMonthlyInvoices"), reminderKey: v.optional(v.string()) },
  handler: async (ctx, { id, reminderKey }): Promise<{ count: number; parts: number; sentTo: string }> => {
    if (!process.env.RESEND_API_KEY) throw new Error("Envoi des bons impossible : RESEND_API_KEY non configurée.");
    const first = await ctx.runQuery(internal.bennesproReceiptData.page, { id, offset: 0 });
    if (!first.total) throw new Error("Aucun bon de dépôt associé à la facture.");
    const secret = env.BENNESPRO_STRIPE_SECRET_KEY;
    if (!secret) throw new Error("Clé Stripe non configurée.");
    const invoice = await stripeGet(secret, `invoices/${first.batch.stripeInvoiceId}`);
    if (invoice.status !== "open" && invoice.status !== "paid") throw new Error("La facture n'est pas finalisée ou a été annulée.");
    const email = first.company.billingEmail?.trim() || first.company.contactEmail?.trim() || "";
    const progress = await ctx.runMutation(internal.bennesproReceiptData.initialize, { id, email });
    const recipient = reminderKey ? email : progress.recipient;
    if (!recipient) throw new Error("Email de facturation manquant.");
    const parts = Math.ceil(first.total / 10);
    const reference = String(invoice.number ?? invoice.id);
    const amount = typeof invoice.total === "number" ? `${(invoice.total / 100).toFixed(2)} € TTC` : "";
    let sentThisRun = false;
    for (let part = 0; part < parts; part++) {
      if (!reminderKey && progress.sent.includes(part)) continue;
      const data = part === 0 ? first : await ctx.runQuery(internal.bennesproReceiptData.page, { id, offset: part * 10 });
      const attachments: EmailAttachment[] = [];
      for (const { depot, vehicle } of data.depots) {
        let signature: Uint8Array | undefined;
        if (depot.signature) {
          const stored = await ctx.storage.get(depot.signature);
          if (!stored) throw new Error(`Signature du bon ${depot.depotNumber} indisponible.`);
          signature = new Uint8Array(await stored.arrayBuffer());
        }
        const pdf = await buildReceiptPdf(depot, data.company, vehicle, signature);
        attachments.push({ filename: `bon-depot-${String(depot.depotNumber).padStart(4, "0")}.pdf`, content: bytesToBase64(pdf) });
      }
      if (attachments.reduce((n, a) => n + a.content.length, 0) > 30 * 1024 * 1024) throw new Error(`Bons trop volumineux pour l'email ${part + 1}/${parts}. Aucun bon n'a été omis.`);
      const range = data.depots.map(({ depot }) => String(depot.depotNumber).padStart(4, "0")).join(", ");
      const link = typeof invoice.hosted_invoice_url === "string" ? `<p><a href="${escape(invoice.hosted_invoice_url)}">Consulter la facture et son paiement</a></p>` : "";
      const html = `<p>Bonjour,</p><p>Vous trouverez en pièces jointes les bons de dépôt n° ${escape(range)} inclus dans la facture ${escape(reference)} (${escape(amount)}).</p><p>Cet envoi contient ${attachments.length} bon(s) sur les ${first.total} bons de la facture. Email ${part + 1}/${parts}.</p>${link}<p>Déchet'Lab — Maison de l'Économie Solidaire</p>`;
      if (sentThisRun) await delay(600);
      const sent = await resendSend(recipient, `Bons de dépôt — facture ${reference} (${part + 1}/${parts})`, html,
        "Déchet'Lab <no-reply@mesoutils.eco-solidaire.fr>", attachments,
        { idempotencyKey: `bp-receipts-${id}-${reminderKey ?? "initial"}-${part}` });
      if (!sent) throw new Error(`Échec de l'envoi des bons (${part + 1}/${parts}). Une reprise est nécessaire.`);
      sentThisRun = true;
      if (!reminderKey) await ctx.runMutation(internal.bennesproReceiptData.markSent, { id, part });
    }
    return { count: first.total, parts, sentTo: recipient };
  },
});
