import type { Doc } from "../_generated/dataModel";

/** Calendar month in the business timezone, including UTC month boundaries. */
export function billingMonth(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit",
  }).formatToParts(timestamp);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

export function aggregateBillingLines<T extends { material: string; weightKg: number; amountCents: number; priceCentsPerKg: number }>(lines: T[]): T[] {
  const totals = new Map<string, T>();
  for (const line of lines) {
    const old = totals.get(line.material);
    if (old) {
      old.weightKg += line.weightKg;
      old.amountCents += line.amountCents;
      old.priceCentsPerKg = old.amountCents / old.weightKg;
    } else totals.set(line.material, { ...line });
  }
  return [...totals.values()];
}

export const DIB = "Tout venant/DIB non triés";
export const WOOD = "Bois";

export function billingTotals(depots: Array<Pick<Doc<"bpDepots">, "billing">>) {
  return depots.reduce((total, d) => {
    const ht = d.billing?.amountCents ?? 0;
    return { ht: total.ht + ht, ttc: total.ttc + ht + Math.round(ht * (d.billing?.vatRate ?? 20) / 100) };
  }, { ht: 0, ttc: 0 });
}

/** One invoice line per deposit, including its original quantities and units. */
export function depositInvoiceDetails(depots: Doc<"bpDepots">[]) {
  return [...depots].sort((a, b) => a.createdAt - b.createdAt || a.depotNumber - b.depotNumber).map(d => {
    if (!d.billing || d.billing.amountCents <= 0) throw new Error("Montant de dépôt manquant.");
    const date = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris" }).format(d.createdAt);
    const quantities = d.items.map(i => `${i.material === DIB ? "DIB" : i.material} : ${i.quantity} ${i.unit}${i.siteRef && i.siteRef !== d.siteRef ? ` (${i.siteRef})` : ""}`).join(" ; ");
    const prices = d.billing.items?.map(i => `${i.material === DIB ? "DIB" : i.material} : ${i.weightKg} kg × ${(i.priceCentsPerKg / 100).toFixed(4)} €/kg HT = ${(i.amountCents / 100).toFixed(2)} € HT`).join(" ; ");
    return {
      depotId: d._id,
      description: `Dépôt n° ${String(d.depotNumber).padStart(4, "0")} du ${date}${d.siteRef ? ` — Chantier : ${d.siteRef}` : ""}\n${quantities}${prices ? `\nFacturation : ${prices}` : ""}`,
      amountCents: d.billing.amountCents,
      vatRate: d.billing.vatRate ?? 20,
    };
  });
}

/** Stripe allows 250 items: large months keep every deposit's full text by
 * placing several consecutive deposits in a line, without dropping details. */
export function stripeDetailLines(details: Array<{ depotId: string; amountCents: number; description: string }>) {
  const size = Math.max(1, Math.ceil(details.length / 250));
  const lines: Array<{ key: string; amountCents: number; description: string }> = [];
  for (let i = 0; i < details.length; i += size) {
    const entries = details.slice(i, i + size);
    lines.push({
      key: entries[0].depotId,
      amountCents: entries.reduce((sum, d) => sum + d.amountCents, 0),
      description: entries.map(d => d.description).join("\n\n"),
    });
  }
  return lines;
}

export function canGroupDeposit(d: Pick<Doc<"bpDepots">, "billing" | "items">): boolean {
  const b = d.billing;
  if (!b || b.amountCents <= 0 || b.groupingId || b.paymentStatusManual || b.paidAt) return false;
  if (!d.items.some(i => i.material === DIB || i.material === WOOD)) return false;
  if (b.stripeInvoiceId) return b.status === "invoiced" && (!b.paymentStatus || b.paymentStatus === "open");
  return b.status === "pending" && !b.monthlyInvoiceId && !b.paymentStatus;
}
