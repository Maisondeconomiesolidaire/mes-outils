import { addDays, format, formatDistanceToNow, startOfHour } from "date-fns";
import { fr } from "date-fns/locale";

export function formatDate(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return format(date, "d MMM yyyy", { locale: fr });
}

export function formatDateTime(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  return format(date, "d MMM yyyy 'à' HH:mm", { locale: fr });
}

/** Comme `formatDateTime` mais avec le jour de la semaine : « Lundi 7 juillet à 10:30 ». */
export function formatDateTimeWithDay(ts: number) {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  const label = format(date, "EEEE d MMMM 'à' HH:mm", { locale: fr });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatRelative(ts: number) {
  return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: fr });
}

/**
 * « il y a X heures / jours / mois / années » — jamais de date précise.
 * Accepte un timestamp ou une chaîne ISO ; renvoie null si invalide.
 */
export function relativeUnits(input: number | string | null | undefined): string | null {
  if (input == null) return null;
  const ts = typeof input === "number" ? input : Date.parse(input);
  if (Number.isNaN(ts)) return null;
  const diff = Math.max(0, Date.now() - ts);
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "il y a moins d'une heure";
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? "s" : ""}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days} jour${days > 1 ? "s" : ""}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? "s" : ""}`;
}

export function toLocalInputValue(ts: number) {
  return format(new Date(ts), "yyyy-MM-dd'T'HH:mm");
}

export function parseLocalInput(value: string) {
  return new Date(value).getTime();
}

export function defaultStart() {
  return startOfHour(new Date()).getTime();
}

export function defaultEnd(days = 0, hours = 1) {
  return addDays(new Date(defaultStart() + hours * 3_600_000), days).getTime();
}
