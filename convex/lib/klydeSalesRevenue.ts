/** Shared sales rules for Klyd reports and the group dashboard. */
type SaleItem = {
  status: string;
  saleRecordedAt?: number;
  actualSalePrice?: number;
  price?: number;
  outlet?: string;
  returnKind?: string;
  returnAmount?: number;
};

/**
 * Une vente annulée n'est plus un encaissement.
 *
 * Qu'il reparte au vendeur ou qu'il reste chez l'acheteur remboursé, l'article
 * ne rapporte rien : le compter dans le chiffre d'affaires gonflerait le
 * rapport d'un argent qui n'est jamais entré. Ce qu'il a coûté se lit à part,
 * via `klydeReturnCost`.
 */
export function isReturnedKlydeSale(item: SaleItem) {
  return item.returnKind !== undefined;
}

/**
 * Ce que l'annulation laisse réellement à notre charge.
 *
 * Un retour aux frais de l'acheteur ne coûte rien ; un retour à nos frais coûte
 * le port ; un remboursement coûte la somme rendue. C'est la somme saisie qui
 * fait foi dans les deux derniers cas.
 */
export function klydeReturnCost(item: SaleItem) {
  if (item.returnKind === undefined || item.returnKind === "retour_client") return 0;
  return item.returnAmount ?? 0;
}

export function isRecordedKlydeSale(item: SaleItem) {
  if (isReturnedKlydeSale(item)) return false;
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
