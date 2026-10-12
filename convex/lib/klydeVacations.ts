/**
 * Mode vacances de Klyd : l'horloge des annonces Vinted s'arrête.
 *
 * Les règles sont ici, partagées par le backend (alerte des trois semaines) et
 * par l'application (ancienneté affichée sur une fiche). Les deux doivent dire
 * la même chose, sans quoi l'alerte partirait sur un article que l'écran
 * annonce encore jeune.
 */

export type VacationPeriod = {
  startedAt: number;
  /** Absent tant que les vacances courent. */
  endedAt?: number;
};

/** Vacances en cours à cet instant. */
export function isOnVacation(periods: readonly VacationPeriod[], at: number) {
  return periods.some((period) => period.startedAt <= at && (period.endedAt ?? Infinity) > at);
}

/**
 * Durée de vacances comprise dans la fenêtre `[from, to]`, en millisecondes.
 *
 * Les périodes qui se chevauchent sont comptées une seule fois : deux congés
 * saisis en double ne doivent pas rajeunir une annonce deux fois.
 */
export function vacationPausedMs(
  periods: readonly VacationPeriod[],
  from: number,
  to: number,
): number {
  if (to <= from) return 0;
  const clipped = periods
    .map((period) => ({
      start: Math.max(period.startedAt, from),
      end: Math.min(period.endedAt ?? to, to),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start);

  let paused = 0;
  let cursor = -Infinity;
  for (const range of clipped) {
    const start = Math.max(range.start, cursor);
    if (range.end > start) {
      paused += range.end - start;
      cursor = range.end;
    }
  }
  return paused;
}

/**
 * Ancienneté effective d'une annonce, vacances déduites, en millisecondes.
 *
 * C'est elle qui décide de l'alerte des trois semaines et qui s'affiche sur la
 * fiche : une annonce postée avant trois semaines de congés n'a pas « traîné »
 * pendant ces trois semaines.
 */
export function vintedElapsedMs(
  vintedAt: number,
  periods: readonly VacationPeriod[],
  now: number,
): number {
  return Math.max(0, now - vintedAt - vacationPausedMs(periods, vintedAt, now));
}

/** La même ancienneté, en jours entiers. */
export function vintedElapsedDays(
  vintedAt: number,
  periods: readonly VacationPeriod[],
  now: number,
): number {
  return Math.floor(vintedElapsedMs(vintedAt, periods, now) / 86_400_000);
}
