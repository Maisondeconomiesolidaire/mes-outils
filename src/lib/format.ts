import { addDays, format, formatDistanceToNow, startOfHour } from "date-fns";
import { fr } from "date-fns/locale";

export function formatDate(ts: number) {
  return format(new Date(ts), "d MMM yyyy", { locale: fr });
}

export function formatDateTime(ts: number) {
  return format(new Date(ts), "d MMM yyyy 'à' HH:mm", { locale: fr });
}

export function formatRelative(ts: number) {
  return formatDistanceToNow(new Date(ts), { addSuffix: true, locale: fr });
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
