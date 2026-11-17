import { addDays, addMonths, addWeeks, format } from "date-fns";
import { fr } from "date-fns/locale";

/** Réservation récurrente : « tous les {every} {unit} jusqu'au {until} ». */
export type Recurrence = { every: number; unit: "day" | "week" | "month"; until: string };

export const MAX_RECURRENCE_SLOTS = 60;

export const RECURRENCE_UNITS: Array<{ value: Recurrence["unit"]; label: string }> = [
  { value: "day", label: "jours" },
  { value: "week", label: "semaines" },
  { value: "month", label: "mois" },
];

function shift(date: Date, unit: Recurrence["unit"], amount: number) {
  return unit === "day" ? addDays(date, amount) : unit === "week" ? addWeeks(date, amount) : addMonths(date, amount);
}

/**
 * Dates de la série, en heure locale : même jour de la semaine / du mois et
 * mêmes heures que le créneau choisi, jusqu'à la date de fin incluse.
 */
export function recurrenceSlots(start: number, end: number, recurrence: Recurrence): Array<{ start: number; end: number }> {
  const every = Math.max(1, Math.floor(recurrence.every || 1));
  const limit = new Date(`${recurrence.until}T23:59:59`).getTime();
  if (!Number.isFinite(limit)) return [{ start, end }];
  const slots: Array<{ start: number; end: number }> = [];
  for (let index = 0; slots.length < MAX_RECURRENCE_SLOTS; index += 1) {
    const slotStart = shift(new Date(start), recurrence.unit, index * every).getTime();
    if (index > 0 && slotStart > limit) break;
    slots.push({ start: slotStart, end: shift(new Date(end), recurrence.unit, index * every).getTime() });
  }
  return slots;
}

export function recurrenceLabel(recurrence: Recurrence) {
  const every = Math.max(1, Math.floor(recurrence.every || 1));
  const until = format(new Date(`${recurrence.until}T12:00:00`), "d MMMM yyyy", { locale: fr });
  const rule = every === 1
    ? recurrence.unit === "day" ? "tous les jours" : recurrence.unit === "week" ? "toutes les semaines" : "tous les mois"
    : `tous les ${every} ${RECURRENCE_UNITS.find((unit) => unit.value === recurrence.unit)?.label}`;
  return `${rule} jusqu'au ${until}`;
}
