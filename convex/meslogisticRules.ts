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

/**
 * Les trois sites sont alignés sur un même axe : Comptoir C à une extrémité,
 * Esspace 150 à l'autre, le Solidarium (Recyclerie du Pays de Bray) entre les
 * deux. Aller du Comptoir C à l'Esspace 150, c'est passer par le Solidarium.
 */
export const AXIS: Record<keyof typeof LOCATIONS, number> = { comptoir_c: 0, recyclerie_pays_de_bray: 1, esspace_150: 2 };
const AXIS_NAMES = ["Comptoir C", "Solidarium (Recyclerie du Pays de Bray)", "Esspace 150"];
export function axisPosition(label: string) {
  const key = canonicalLocation(label);
  return key === undefined ? undefined : AXIS[key];
}
type Trip = { origin: string; destination: string };
function direction(trip: Trip) {
  const from = axisPosition(trip.origin), to = axisPosition(trip.destination);
  return from === undefined || to === undefined || from === to ? 0 : Math.sign(to - from);
}
/** Même sens de circulation sur l'axe. */
export function sameDirection(route: Trip, trip: Trip) {
  const dir = direction(route);
  return dir !== 0 && direction(trip) === dir;
}
/** Le trajet tient dans celui de la tournée, dans le même sens : on l'embarque sans détour. */
export function onTheWay(route: Trip, trip: Trip) {
  if (!sameDirection(route, trip)) return false;
  const a = axisPosition(route.origin)!, b = axisPosition(route.destination)!;
  const c = axisPosition(trip.origin)!, d = axisPosition(trip.destination)!;
  return Math.min(c, d) >= Math.min(a, b) && Math.max(c, d) <= Math.max(a, b);
}
/**
 * Ordre des arrêts d'une tournée qui couvre ces trajets : on balaie l'axe dans
 * le sens du premier trajet (chargements et déchargements au passage), puis on
 * revient pour les trajets de sens inverse. `null` si un lieu est inconnu.
 */
export function tourStops(trips: Trip[]): string[] | null {
  if (!trips.length || trips.some(trip => direction(trip) === 0)) return null;
  const dir = direction(trips[0]);
  const forward = trips.filter(trip => direction(trip) === dir);
  const backward = trips.filter(trip => direction(trip) !== dir);
  const positions = (list: Trip[], sign: number) => [...new Set(list.flatMap(trip => [axisPosition(trip.origin)!, axisPosition(trip.destination)!]))].sort((x, y) => sign * (x - y));
  const stops = positions(forward, dir);
  for (const position of positions(backward, -dir)) if (stops[stops.length - 1] !== position) stops.push(position);
  return stops.map(position => AXIS_NAMES[position]);
}
