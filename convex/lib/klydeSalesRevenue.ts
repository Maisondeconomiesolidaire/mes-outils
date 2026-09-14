/** Shared sales rules for Klyd reports and the group dashboard. */
type SaleItem = {
  status: string;
  saleRecordedAt?: number;
  actualSalePrice?: number;
  price?: number;
  outlet?: string;
};
export function isRecordedKlydeSale(item: SaleItem) {
  return item.saleRecordedAt !== undefined || ["en_cours_envoi", "envoye", "gagne", "vendu"].includes(item.status);
}
export function klydeSaleAmount(item: SaleItem) {
  // Legacy zero values mean no actual sale price was entered.
  return item.actualSalePrice || item.price || 0;
}
export function summarizeKlydeSales(items: readonly SaleItem[]) {
  const byOutlet = { klyd: 0, mobifrip: 0 };
  let salesCount = 0;
  for (const item of items) {
    if (!isRecordedKlydeSale(item)) continue;
    byOutlet[item.outlet === "mobifrip" ? "mobifrip" : "klyd"] += klydeSaleAmount(item);
    salesCount++;
  }
  byOutlet.klyd = Math.round(byOutlet.klyd * 100) / 100;
  byOutlet.mobifrip = Math.round(byOutlet.mobifrip * 100) / 100;
  return { revenue: Math.round((byOutlet.klyd + byOutlet.mobifrip) * 100) / 100, salesCount, byOutlet };
}
