/** Pure routing rules shared by automatic order creation and validation. */
export const LOCATIONS = {
  recyclerie_pays_de_bray: "Recyclerie du Pays de Bray",
  comptoir_c: "Comptoir C",
  esspace_150: "Esspace 150 / Recyclerie de Gournay",
} as const;
export function canonicalLocation(value?: string) {
  const name = value?.trim().toLocaleLowerCase("fr-FR") ?? "";
  if (name.includes("comptoir")) return "comptoir_c";
  if (name.includes("solidarium") || name.includes("usine") || name.includes("pays de bray") || name.includes("pays_de_bray") || name.includes("lachapelle")) return "recyclerie_pays_de_bray";
  if (name.includes("esspace") || name.includes("gournay")) return "esspace_150";
  return undefined;
}
export function transportRoute(origin: string | undefined, pickup: string | undefined) {
  if (!pickup) return null;
  const destination = canonicalLocation(pickup);
  if (!destination || canonicalLocation(origin) === destination) return null;
  // An unknown depot requires an operator to clarify the origin, never silently omit it.
  return { origin: origin?.trim() || "Lieu de départ à préciser", destination: LOCATIONS[destination] };
}
export function validTransition(from: string, to: string, prepared: boolean) {
  return (from === "a_preparer" && to === "en_transit" && prepared)
    || (from === "en_transit" && to === "receptionnee")
    || (from === "a_preparer" && to === "annulee");
}
