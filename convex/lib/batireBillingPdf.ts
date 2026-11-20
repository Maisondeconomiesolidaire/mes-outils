/**
 * Devis et factures Bâtire au format PDF (pdf-lib, JavaScript pur).
 *
 * Source unique : le CRM Bâtire l'importe pour l'aperçu et l'envoi manuel,
 * le serveur pour envoyer d'office la facture après un paiement par carte.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type Issuer = "recyclerie" | "materiosol";

/** Émetteurs des devis et factures : mobilier → Recyclerie, le reste → MATERIOSOL. */
export const ISSUERS: Record<Issuer, { name: string; short: string; color: string; address: string[]; siret: string; vat: string; rna: string; legal: string }> = {
  recyclerie: {
    name: "Recyclerie du Pays de Bray",
    short: "Recyclerie",
    // Orange de la Recyclerie (Recycapp).
    color: "#ff7700",
    address: ["4 rue de la Prairie, ZA du Grand Pré", "60650 Lachapelle-aux-Pots"],
    siret: "503 123 044 00011",
    vat: "FR62503123044",
    rna: "W601001874",
    legal: "Association déclarée — SIREN 503 123 044",
  },
  materiosol: {
    name: "MATERIOSOL",
    short: "MATERIOSOL",
    // Bleu BâtiRe.
    color: "#2795b3",
    address: ["4 rue de la Prairie", "60650 Lachapelle-aux-Pots"],
    siret: "921 005 526 00014",
    vat: "FR11921005526",
    rna: "W601008605",
    legal: "Association déclarée — SIREN 921 005 526",
  },
};

export const issuerOfCategory = (category: string): Issuer => category.trim().toLocaleLowerCase("fr-FR").startsWith("mobilier") ? "recyclerie" : "materiosol";

export const VAT_RATES = [20, 10, 5.5, 0] as const;

/** Montant TTC → HT (au centime) pour un taux de TVA donné. */
export const htCents = (ttcCents: number, vatRate: number) => Math.round(ttcCents * 100 / (100 + vatRate));

/** Montants TTC → HT / TVA (prix catalogue Bâtire affichés TTC). */
export function vatBreakdown(totalCents: number, vatRate: number) {
  const vatCents = Math.round(totalCents * vatRate / (100 + vatRate));
  return { totalCents, vatCents, netCents: totalCents - vatCents };
}

export const euros = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const [whole, decimals] = (Math.abs(cents) / 100).toFixed(2).split(".");
  return `${sign}${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${decimals} €`;
};

export const frDate = (day?: string) => day ? new Date(`${day}T12:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";

export type BillingClient = { company?: string; firstName?: string; lastName?: string; email?: string; phone?: string; address?: string; postalCode?: string; city?: string; siret?: string; vatNumber?: string };
export const clientName = (client: BillingClient) => client.company || [client.firstName, client.lastName].filter(Boolean).join(" ") || client.email || "Client";

export type BillingDocForPdf = {
  type: "devis" | "facture"; issuer: Issuer; number: string; issueDate: string; validUntil?: string; dueDate?: string;
  client: BillingClient; lines: { label: string; quantity: number; unit?: string; unitPriceCents: number }[];
  vatRate: number; totalCents: number; notes?: string; status?: string; paidAt?: number; paymentMethod?: string;
};

/* ------------------------------------------------------------------ */
/* PDF (pdf-lib, polices standard : encodage WinAnsi)                   */
/* ------------------------------------------------------------------ */

const WINANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
/** Les polices standard ne connaissent que WinAnsi : espaces fines et symboles exotiques sont remplacés. */
function safe(text: string) {
  return text.replace(/[   ]/g, " ").replace(/[‐‑]/g, "-").split("").map(char => char.charCodeAt(0) < 256 || WINANSI_EXTRA.has(char) ? char : "?").join("").replace(/[\u0000-\u0009\u000b-\u001f]/g, "");
}

function hex(color: string) {
  const value = parseInt(color.slice(1), 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of safe(text).split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { current = candidate; continue; }
      if (current) lines.push(current);
      // Mot plus long que la colonne : coupé net.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
        lines.push(rest.slice(0, cut)); rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

const quantityText = (quantity: number, unit?: string) => `${quantity.toLocaleString("fr-FR", { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ""}`;

export async function buildBillingPdf(doc: BillingDocForPdf) {
  const issuer = ISSUERS[doc.issuer];
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.type === "devis" ? "Devis" : "Facture"} ${doc.number}`);
  pdf.setAuthor(issuer.name);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hex(issuer.color);
  const dark = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.42, 0.45, 0.5);
  const line = rgb(0.86, 0.88, 0.9);
  const W = 595.28, H = 841.89, M = 44, bottom = 70;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (value: string, x: number, at: number, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const size = options.size ?? 9.5, f = options.font ?? font, content = safe(value);
    const dx = options.align === "right" ? x - f.widthOfTextAtSize(content, size) : x;
    page.drawText(content, { x: dx, y: at, size, font: f, color: options.color ?? dark });
  };

  // En-tête : émetteur à gauche, document à droite.
  page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent });
  text(issuer.name, M, y - 8, { size: 16, font: bold });
  let left = y - 26;
  for (const row of [...issuer.address, `SIRET ${issuer.siret}`, `TVA intracommunautaire ${issuer.vat}`, `RNA ${issuer.rna}`]) { text(row, M, left, { color: muted }); left -= 12.5; }
  const title = doc.type === "devis" ? "DEVIS" : "FACTURE";
  text(title, W - M, y - 10, { size: 24, font: bold, color: accent, align: "right" });
  let right = y - 30;
  const meta: [string, string][] = [["N°", doc.number], ["Date", frDate(doc.issueDate)]];
  if (doc.type === "devis" && doc.validUntil) meta.push(["Valable jusqu’au", frDate(doc.validUntil)]);
  if (doc.type === "facture" && doc.dueDate) meta.push(["Échéance", frDate(doc.dueDate)]);
  for (const [label, value] of meta) { text(`${label} : `, W - M - bold.widthOfTextAtSize(safe(value), 10), right, { size: 10, color: muted, align: "right" }); text(value, W - M, right, { size: 10, font: bold, align: "right" }); right -= 14; }
  y = Math.min(left, right) - 14;

  // Client.
  const boxX = W / 2 + 10, boxW = W - M - boxX;
  const clientRows = [
    ...(doc.client.company && (doc.client.firstName || doc.client.lastName) ? [[doc.client.firstName, doc.client.lastName].filter(Boolean).join(" ")] : []),
    doc.client.address, [doc.client.postalCode, doc.client.city].filter(Boolean).join(" "), doc.client.email, doc.client.phone,
    doc.client.siret ? `SIRET ${doc.client.siret}` : undefined, doc.client.vatNumber ? `TVA ${doc.client.vatNumber}` : undefined,
  ].filter((row): row is string => Boolean(row));
  const nameLines = wrap(clientName(doc.client), bold, 11, boxW - 24);
  const boxH = 30 + nameLines.length * 14 + clientRows.length * 12.5;
  page.drawRectangle({ x: boxX, y: y - boxH, width: boxW, height: boxH, borderColor: line, borderWidth: 1, color: rgb(0.98, 0.985, 0.99) });
  text(doc.type === "devis" ? "DESTINATAIRE" : "FACTURÉ À", boxX + 12, y - 16, { size: 8, font: bold, color: muted });
  let cy = y - 31;
  for (const row of nameLines) { text(row, boxX + 12, cy, { size: 11, font: bold }); cy -= 14; }
  for (const row of clientRows) { for (const part of wrap(row, font, 9.5, boxW - 24)) { text(part, boxX + 12, cy); cy -= 12.5; } }
  y = y - boxH - 26;

  // Tableau des lignes.
  const cols = { label: M + 8, qty: W - M - 290, unitHt: W - M - 228, unit: W - M - 162, totalHt: W - M - 86, total: W - M - 8 };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 20, width: W - 2 * M, height: 20, color: accent });
    const head = { size: 8.5, font: bold, color: rgb(1, 1, 1) };
    text("Désignation", cols.label, y - 13.5, head);
    text("Quantité", cols.qty, y - 13.5, { ...head, align: "right" });
    text("PU HT", cols.unitHt, y - 13.5, { ...head, align: "right" });
    text("PU TTC", cols.unit, y - 13.5, { ...head, align: "right" });
    text("Total HT", cols.totalHt, y - 13.5, { ...head, align: "right" });
    text("Total TTC", cols.total, y - 13.5, { ...head, align: "right" });
    y -= 20;
  };
  const newPage = () => { page = pdf.addPage([W, H]); page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: accent }); y = H - M; };
  header();
  for (const [index, row] of doc.lines.entries()) {
    const labelLines = wrap(row.label, font, 9.5, cols.qty - 55 - cols.label);
    const rowH = Math.max(22, 10 + labelLines.length * 12);
    if (y - rowH < bottom + 20) { newPage(); header(); }
    if (index % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: W - 2 * M, height: rowH, color: rgb(0.97, 0.975, 0.98) });
    labelLines.forEach((part, at) => text(part, cols.label, y - 14 - at * 12));
    text(quantityText(row.quantity, row.unit), cols.qty, y - 14, { align: "right" });
    const lineTtc = Math.round(row.quantity * row.unitPriceCents);
    text(euros(htCents(row.unitPriceCents, doc.vatRate)), cols.unitHt, y - 14, { size: 9, color: muted, align: "right" });
    text(euros(row.unitPriceCents), cols.unit, y - 14, { size: 9, align: "right" });
    text(euros(htCents(lineTtc, doc.vatRate)), cols.totalHt, y - 14, { size: 9, color: muted, align: "right" });
    text(euros(lineTtc), cols.total, y - 14, { size: 9, font: bold, align: "right" });
    y -= rowH;
  }
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: line });

  // Totaux.
  const { netCents, vatCents } = vatBreakdown(doc.totalCents, doc.vatRate);
  if (y - 80 < bottom) newPage();
  y -= 18;
  const totals: [string, string, boolean][] = [["Total HT", euros(netCents), false], [`TVA ${doc.vatRate.toLocaleString("fr-FR")} %`, euros(vatCents), false], ["Total TTC", euros(doc.totalCents), true]];
  for (const [label, value, strong] of totals) {
    if (strong) { y -= 10; page.drawRectangle({ x: W - M - 220, y: y - 8, width: 220, height: 24, color: accent }); }
    text(label, W - M - 210, y, { size: strong ? 11 : 9.5, font: strong ? bold : font, color: strong ? rgb(1, 1, 1) : muted });
    text(value, W - M - 10, y, { size: strong ? 12 : 9.5, font: bold, color: strong ? rgb(1, 1, 1) : dark, align: "right" });
    y -= strong ? 30 : 16;
  }
  if (doc.type === "facture" && doc.status === "payee") {
    text(`Payée${doc.paidAt ? ` le ${new Date(doc.paidAt).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}` : ""}${doc.paymentMethod ? ` (${doc.paymentMethod})` : ""}`, W - M, y, { size: 10, font: bold, color: rgb(0.09, 0.6, 0.29), align: "right" });
    y -= 18;
  }

  // Notes, conditions, signature.
  const block = (heading: string, body: string) => {
    const parts = wrap(body, font, 9, W - 2 * M);
    if (y - 18 - parts.length * 11.5 < bottom) newPage();
    text(heading, M, y, { size: 9, font: bold }); y -= 13;
    for (const part of parts) { text(part, M, y, { size: 9, color: muted }); y -= 11.5; }
    y -= 8;
  };
  y -= 6;
  if (doc.notes) block("Notes", doc.notes);
  if (doc.type === "devis") {
    block("Conditions", `Devis valable jusqu’au ${frDate(doc.validUntil)}. Prix TTC, matériaux de réemploi vendus en l’état. Retrait sur le lieu de stockage ou transfert sur demande.`);
    if (y - 90 < bottom) newPage();
    page.drawRectangle({ x: W - M - 230, y: y - 80, width: 230, height: 80, borderColor: line, borderWidth: 1 });
    text("Bon pour accord", W - M - 220, y - 16, { size: 9.5, font: bold });
    text("Date, signature et cachet du client", W - M - 220, y - 29, { size: 8.5, color: muted });
    y -= 92;
  } else {
    block("Conditions de paiement", `Paiement à réception de la facture, au plus tard le ${frDate(doc.dueDate)}. Pas d’escompte pour paiement anticipé. En cas de retard de paiement : pénalités au taux de trois fois le taux d’intérêt légal, et indemnité forfaitaire pour frais de recouvrement de 40 € (clients professionnels, art. L441-10 du Code de commerce).`);
  }

  // Pied de page sur chaque page.
  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    const footer = safe(`${issuer.name} · ${issuer.address.join(", ")} · ${issuer.legal} · SIRET ${issuer.siret} · TVA ${issuer.vat} · RNA ${issuer.rna}`);
    const lines = wrap(footer, font, 7.5, W - 2 * M - 40);
    lines.forEach((part, at) => current.drawText(part, { x: M, y: 34 - at * 10, size: 7.5, font, color: muted }));
    current.drawText(`${index + 1} / ${pages.length}`, { x: W - M - font.widthOfTextAtSize(`${index + 1} / ${pages.length}`, 7.5), y: 34, size: 7.5, font, color: muted });
    current.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.5, color: line });
  });
  return await pdf.save();
}
