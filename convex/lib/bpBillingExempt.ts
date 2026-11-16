/**
 * Entreprises dont les dépôts Bennes & Pro (déchet'lab) sont entièrement
 * gratuits, DIB et bois compris. Matériosol est la structure du groupe qui
 * exploite le site : ses propres apports ne sont jamais facturés. Toutes les
 * autres entreprises restent facturées au tarif habituel.
 *
 * Reconnue par son SIRET (stable), ou par son nom si le SIRET n'est pas saisi.
 * Module pur : importé par le backend ET par le front Bennes & Pro, pour que
 * l'affichage (« Gratuit ») et la facturation suivent exactement la même règle.
 */
const EXEMPT_SIRETS = new Set(["92100552600014"]);
const EXEMPT_NAMES = new Set(["materiosol"]);

function normalizeName(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isBillingExemptCompany(company: { name?: string | null; siret?: string | null } | null | undefined): boolean {
  if (!company) return false;
  const siret = company.siret?.replace(/\D/g, "");
  if (siret && EXEMPT_SIRETS.has(siret)) return true;
  return Boolean(company.name && EXEMPT_NAMES.has(normalizeName(company.name)));
}
