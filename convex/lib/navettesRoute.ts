/**
 * Règles pures de l'onglet « Navettes » de Mes Outils : quels sites logistiques
 * se trouvent sur le trajet d'un conducteur, et quels transits Meslogistic il
 * peut donc emporter sans détour.
 *
 * Un trajet part TOUJOURS du Solidarium (Recyclerie du Pays de Bray, 4 rue de la
 * Prairie à Lachapelle-aux-Pots), va à la destination, puis revient : c'est un
 * aller-retour. Un site est « sur la route » si y passer à l'aller ne rallonge
 * le trajet que d'un petit détour. Le Solidarium l'est toujours (départ et
 * retour). Un transit est faisable si son départ ET son arrivée sont sur la
 * route : on charge au passage et on décharge à l'aller ou au retour.
 */
import { canonicalLocation, LOCATIONS } from "../meslogisticRules";

export type SiteKey = keyof typeof LOCATIONS;

export const HOME_SITE: SiteKey = "recyclerie_pays_de_bray";
export const HOME_ADDRESS = "4 Rue de la Prairie, 60650 Lachapelle-aux-Pots";

/** Coordonnées des sites (géocodées une fois pour toutes). */
export const SITES: Record<SiteKey, { name: string; address: string; longitude: number; latitude: number }> = {
  recyclerie_pays_de_bray: { name: "Solidarium (Lachapelle-aux-Pots)", address: HOME_ADDRESS, longitude: 1.902428, latitude: 49.442296 },
  comptoir_c: { name: "Comptoir C (Beauvais)", address: "13 Av. Pierre Bérégovoy, 60000 Beauvais", longitude: 2.102754, latitude: 49.44058 },
  esspace_150: { name: "Esspace 150 (Gournay-en-Bray)", address: "150 Rte de Paris, 76220 Gournay-en-Bray", longitude: 1.725067, latitude: 49.469388 },
};

export const SITE_KEYS = Object.keys(SITES) as SiteKey[];

export function isSiteKey(value: string): value is SiteKey {
  return (SITE_KEYS as string[]).includes(value);
}

/** Détour toléré à l'aller : 8 km, ou 15 % du trajet s'il est long. */
export function maxDetourKm(oneWayKm: number): number {
  return Math.max(8, oneWayKm * 0.15);
}

export function isOnRoute(detourKm: number, oneWayKm: number): boolean {
  return detourKm <= maxDetourKm(oneWayKm);
}

/** Kilométrage aller-retour, arrondi au km. */
export function roundTripKm(oneWayKm: number): number {
  return Math.round(oneWayKm * 2);
}

/** Le transit (départ → arrivée) tient dans le trajet : ses deux lieux sont sur la route. */
export function transitOnRoute(transit: { origin: string; destination: string }, sitesOnRoute: readonly string[]): boolean {
  const from = canonicalLocation(transit.origin);
  const to = canonicalLocation(transit.destination);
  if (!from || !to || from === to) return false;
  const onRoute = new Set([HOME_SITE, ...sitesOnRoute]);
  return onRoute.has(from) && onRoute.has(to);
}

/** Date (AAAA-MM-JJ) d'un instant, en heure de Paris : la date de la navette. */
export function parisDay(timestamp: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}
