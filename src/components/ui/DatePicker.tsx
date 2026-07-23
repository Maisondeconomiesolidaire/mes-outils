import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  getYear,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  setYear,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "../../lib/cn";

const WEEKDAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

/** Sélecteur de date simple (sans heure). Valeur au format "YYYY-MM-DD". */
export function DatePicker({
  value,
  onChange,
  placeholder = "Choisir une date",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? safeParse(value) : null;
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 }),
      }),
    [viewMonth],
  );
  const availableYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const selectedYear = selected ? getYear(selected) : currentYear;
    const start = Math.min(currentYear - 30, selectedYear - 5);
    const end = Math.max(currentYear + 10, selectedYear + 5);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, [selected]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((c) => !c)}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-left text-sm font-medium text-[var(--foreground)] transition",
          "hover:border-brand-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15",
          open && "border-brand-500 ring-4 ring-brand-500/15",
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-brand-600" />
        <span className={cn("flex-1", !selected && "text-[var(--muted-foreground)]")}>
          {selected ? format(selected, "EEEE d MMMM yyyy", { locale: fr }) : placeholder}
        </span>
        {selected ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => { event.stopPropagation(); onChange(""); }}
            className="rounded-full p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-2 w-72 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-[var(--shadow-strong)]">
          <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--accent)] px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Date</p>
            <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
              {selected ? format(selected, "EEEE d MMMM yyyy", { locale: fr }) : "À définir"}
            </p>
          </div>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setViewMonth((c) => subMonths(c, 1))} className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"><ChevronLeft className="h-4 w-4" /></button>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold capitalize text-[var(--foreground)]">{format(viewMonth, "MMMM", { locale: fr })}</span>
              <select
                aria-label="Choisir une année"
                value={getYear(viewMonth)}
                onChange={(event) => setViewMonth((current) => setYear(current, Number(event.target.value)))}
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-1.5 py-1 text-sm font-semibold text-[var(--foreground)] outline-none transition hover:border-brand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15"
              >
                {availableYears.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => setViewMonth((c) => addMonths(c, 1))} className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 pb-1">
            {WEEKDAYS.map((day) => <span key={day} className="text-center text-[10px] font-bold uppercase text-[var(--muted-foreground)]">{day}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const isSelected = selected && isSameDay(day, selected);
              const outside = !isSameMonth(day, viewMonth);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => { onChange(format(day, "yyyy-MM-dd")); setOpen(false); }}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-lg text-sm font-medium transition",
                    isSelected ? "bg-brand-500 text-white" : outside ? "text-[var(--muted-foreground)]/50 hover:bg-[var(--accent)]" : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                  )}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function safeParse(value: string): Date | null {
  try {
    const date = parseISO(value);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}
