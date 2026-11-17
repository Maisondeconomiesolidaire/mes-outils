import { addWeeks, format } from "date-fns";
import { fr } from "date-fns/locale";

/**
 * Réservation récurrente : le même jour de la semaine, aux mêmes heures que le
 * créneau choisi, chaque semaine jusqu'à `until` (YYYY-MM-DD) inclus.
 */
export type Recurrence = { until: string };

export const MAX_RECURRENCE_SLOTS = 60;

/** Dates de la série, en heure locale (les changements d'heure sont respectés). */
export function recurrenceSlots(start: number, end: number, recurrence: Recurrence): Array<{ start: number; end: number }> {
  const limit = new Date(`${recurrence.until}T23:59:59`).getTime();
  if (!Number.isFinite(limit)) return [{ start, end }];
  const slots: Array<{ start: number; end: number }> = [];
  for (let week = 0; slots.length < MAX_RECURRENCE_SLOTS; week += 1) {
    const slotStart = addWeeks(new Date(start), week).getTime();
    if (week > 0 && slotStart > limit) break;
    slots.push({ start: slotStart, end: addWeeks(new Date(end), week).getTime() });
  }
  return slots;
}

/** « tous les jeudis de 11:00 à 18:00 jusqu'au 30 juin 2027 » */
export function recurrenceLabel(recurrence: Recurrence, start: number, end: number) {
  const weekday = format(new Date(start), "EEEE", { locale: fr });
  const until = format(new Date(`${recurrence.until}T12:00:00`), "d MMMM yyyy", { locale: fr });
  return `tous les ${weekday}s de ${format(new Date(start), "HH:mm")} à ${format(new Date(end), "HH:mm")} jusqu'au ${until}`;
}
