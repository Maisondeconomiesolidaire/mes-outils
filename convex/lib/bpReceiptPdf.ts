import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Doc } from "../_generated/dataModel";

/** Pure JS PDF generation: also runs in scheduled Convex actions, without a browser. */
export async function buildReceiptPdf(depot: Doc<"bpDepots">, company: Doc<"bpCompanies">, vehicle: Doc<"bpVehicles"> | null, signature?: Uint8Array) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Bon de dépôt ${depot.depotNumber}`);
  pdf.setCreationDate(new Date(depot.createdAt));
  pdf.setModificationDate(new Date(depot.createdAt));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  function text(value: string, heading = false) {
    const face = heading ? bold : font;
    const size = heading ? 13 : 10;
    // Helvetica supports French/WinAnsi. Unsupported characters are represented
    // explicitly rather than letting an emoji prevent all receipts being sent.
    const safe = Array.from(value).map(c => { if (c === "\n") return c; try { face.encodeText(c); return c; } catch { return "?"; } }).join("");
    for (const paragraph of safe.split("\n")) {
      let line = "";
      for (const char of paragraph) {
        if (face.widthOfTextAtSize(line + char, size) > 505) { draw(line); line = ""; }
        line += char;
      }
      draw(line);
    }
    function draw(line: string) {
      if (y < 55) { page = pdf.addPage([595.28, 841.89]); y = 790; }
      page.drawText(line, { x: 45, y, font: face, size, color: heading ? rgb(0.08, 0.3, 0.27) : rgb(0.1, 0.1, 0.1) });
      y -= heading ? 23 : 15;
    }
    y -= 5;
  }
  text("Déchet'Lab — BON DE DÉPÔT", true);
  const date = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }).format(depot.createdAt);
  text(`N° ${String(depot.depotNumber).padStart(4, "0")} — ${date}`);
  text("Entreprise", true);
  text([company.name, company.siret ? `SIRET : ${company.siret}` : "", company.address ?? ""].filter(Boolean).join("\n"));
  text(`Déposant : ${depot.depositorName}\nVéhicule : ${[vehicle?.label, vehicle?.plate].filter(Boolean).join(" — ") || "Non renseigné"}\nChantier : ${depot.siteRef || "Non renseigné"}`);
  text("Matériaux déposés", true);
  for (const item of depot.items) text(`${item.material} : ${item.quantity} ${item.unit === "unite" ? "unité(s)" : item.unit === "m3" ? "m³" : item.unit}${item.siteRef ? ` — Chantier : ${item.siteRef}` : ""}`);
  if (depot.comment) { text("Commentaire", true); text(depot.comment); }
  if (depot.billing) {
    const ht = depot.billing.amountCents;
    const ttc = ht + Math.round(ht * (depot.billing.vatRate ?? 20) / 100);
    text(`Montant : ${(ht / 100).toFixed(2)} € HT / ${(ttc / 100).toFixed(2)} € TTC`);
  }
  if (y < 170) { page = pdf.addPage([595.28, 841.89]); y = 790; }
  text("Signature du déposant", true);
  text(`${depot.depositorName} — ${date}`);
  if (signature) {
    const image = signature[0] === 0x89 ? await pdf.embedPng(signature) : await pdf.embedJpg(signature);
    const dimensions = image.scaleToFit(240, 85);
    page.drawImage(image, { x: 45, y: y - dimensions.height, ...dimensions });
  } else text("Signature non enregistrée sur ce dépôt.");
  return pdf.save();
}
