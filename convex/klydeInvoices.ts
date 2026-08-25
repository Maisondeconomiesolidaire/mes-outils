/**
 * Factures des ventes Vinted (enseigne Mobifrip).
 *
 * Un vendeur Pro doit joindre une facture au colis. Toutes les données
 * nécessaires sont déjà dans l'email de vente — article, montant, coordonnées
 * de l'acheteur — d'où une génération en un clic depuis la boîte Vinted plutôt
 * qu'une ressaisie dans un tableur.
 */
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";
import { buildSimplePdf, type PdfLine } from "./pdf";

const PAGE_KEY = "klyde:vinted";

/** Émetteur des factures. Volontairement sans logo : facture de gestion. */
const SELLER = {
  name: "Mobifrip",
  address: "4 rue de la Prairie",
  city: "60650 Lachapelle-aux-Pots",
};

/** Préfixe de numérotation : « MF-2026-004 ». */
const INVOICE_PREFIX = "MF";

function formatEuro(amount: number) {
  return `${amount.toFixed(2).replace(".", ",")} €`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

export const getEmail = internalQuery({
  args: { emailId: v.id("klydeVintedEmails") },
  handler: async (ctx, args) => ctx.db.get(args.emailId),
});

/**
 * Réserve (ou renvoie) le numéro de facture d'une vente. Une numérotation
 * continue est une obligation légale : le numéro est donc attribué en base, et
 * jamais recalculé — regénérer le PDF d'une facture existante en conserve le
 * numéro.
 */
export const reserveInvoiceNumber = internalMutation({
  args: { emailId: v.id("klydeVintedEmails") },
  handler: async (ctx, args): Promise<string> => {
    const email = await ctx.db.get(args.emailId);
    if (!email) throw new Error("Email introuvable.");
    if (email.invoiceNumber) return email.invoiceNumber;

    const year = new Date(email.sentAt).getFullYear();
    const prefix = `${INVOICE_PREFIX}-${year}-`;
    const rows = await ctx.db.query("klydeVintedEmails").collect();
    const used = rows
      .map((row) => row.invoiceNumber)
      .filter((number): number is string => Boolean(number?.startsWith(prefix)))
      .map((number) => Number(number.slice(prefix.length)))
      .filter((value) => Number.isFinite(value));
    const next = (used.length ? Math.max(...used) : 0) + 1;

    const invoiceNumber = `${prefix}${String(next).padStart(3, "0")}`;
    await ctx.db.patch(args.emailId, { invoiceNumber });
    return invoiceNumber;
  },
});

export const attachInvoice = internalMutation({
  args: {
    emailId: v.id("klydeVintedEmails"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);
    if (!email) throw new Error("Email introuvable.");
    // Une regénération remplace le PDF : l'ancien n'a plus de référence.
    if (email.invoiceStorageId) await ctx.storage.delete(email.invoiceStorageId);
    await ctx.db.patch(args.emailId, {
      invoiceStorageId: args.storageId,
      invoiceGeneratedAt: Date.now(),
    });
  },
});

/** Composition de la facture, à partir des données extraites de l'email. */
export function invoiceLines(
  email: Doc<"klydeVintedEmails">,
  invoiceNumber: string,
): PdfLine[] {
  const amount = email.amount ?? 0;
  const lines: PdfLine[] = [
    { text: "FACTURE", size: 22, bold: true },
    { text: `N° ${invoiceNumber}`, size: 10, spaceBefore: 2 },
    { text: `Date : ${formatDate(email.sentAt)}`, size: 10 },

    { text: SELLER.name, size: 13, bold: true, spaceBefore: 22 },
    { text: SELLER.address, size: 10 },
    { text: SELLER.city, size: 10 },

    { text: "Facturé à", size: 11, bold: true, spaceBefore: 22 },
  ];

  if (email.buyerName) lines.push({ text: email.buyerName, size: 10 });
  // L'adresse répète le nom : on ne le réaffiche pas deux fois.
  const postal = email.buyerAddress && email.buyerName
    ? email.buyerAddress.replace(`${email.buyerName},`, "").trim()
    : email.buyerAddress;
  if (postal) lines.push({ text: postal, size: 10 });
  if (email.buyerEmail) lines.push({ text: email.buyerEmail, size: 10 });
  if (!email.buyerName && !email.buyerAddress && email.buyer) {
    lines.push({ text: `Acheteur Vinted : ${email.buyer}`, size: 10 });
  }

  lines.push(
    { text: "Désignation", size: 11, bold: true, spaceBefore: 26, right: "Montant" },
    {
      text: email.itemTitle ?? "Article d'occasion",
      size: 10,
      spaceBefore: 6,
      right: formatEuro(amount),
    },
    { text: "Total", size: 13, bold: true, spaceBefore: 20, right: formatEuro(amount) },
  );

  const references = [
    email.orderRef ? `Commande n° ${email.orderRef}` : null,
    email.buyer ? `Acheteur Vinted : ${email.buyer}` : null,
  ].filter((value): value is string => Boolean(value));
  if (references.length > 0) {
    lines.push({ text: references.join(" · "), size: 9, spaceBefore: 26 });
  }
  lines.push({ text: "Vente réalisée sur Vinted.", size: 9, spaceBefore: 2 });
  return lines;
}

/**
 * Génère (ou regénère) la facture PDF d'une vente et la range dans le stockage
 * Convex. Renvoie le lien de consultation.
 */
export const generate = action({
  args: { emailId: v.id("klydeVintedEmails") },
  handler: async (ctx, args): Promise<{ invoiceNumber: string; url: string | null }> => {
    await ctx.runQuery(internal.klydeInvoices.assertCanGenerate, {});
    const email: Doc<"klydeVintedEmails"> | null = await ctx.runQuery(
      internal.klydeInvoices.getEmail,
      { emailId: args.emailId },
    );
    if (!email) throw new Error("Email introuvable.");
    if (email.kind !== "vente") {
      throw new Error("Seul un email de vente donne lieu à une facture.");
    }

    const invoiceNumber: string = await ctx.runMutation(
      internal.klydeInvoices.reserveInvoiceNumber,
      { emailId: args.emailId },
    );
    const pdf = buildSimplePdf(invoiceLines(email, invoiceNumber));
    const storageId: Id<"_storage"> = await ctx.storage.store(
      new Blob([pdf as unknown as BlobPart], { type: "application/pdf" }),
    );
    await ctx.runMutation(internal.klydeInvoices.attachInvoice, {
      emailId: args.emailId,
      storageId,
    });
    return { invoiceNumber, url: await ctx.storage.getUrl(storageId) };
  },
});

export const assertCanGenerate = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    return true;
  },
});

/** Lien de consultation d'une facture déjà générée. */
export const invoiceUrl = query({
  args: { emailId: v.id("klydeVintedEmails") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const email = await ctx.db.get(args.emailId);
    if (!email?.invoiceStorageId) return null;
    return {
      invoiceNumber: email.invoiceNumber ?? null,
      generatedAt: email.invoiceGeneratedAt ?? null,
      url: await ctx.storage.getUrl(email.invoiceStorageId),
    };
  },
});
