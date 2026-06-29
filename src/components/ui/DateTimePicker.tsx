import { useEffect, useMemo, useRef, useState } from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  setHours,
  setMinutes,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { cn } from "../../lib/cn";

const WEEKDAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
export const HOURS = Array.from({ length: 24 }, (_, index) => index);
export const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Choisir une date",
  className,
}: {
  value: number | null;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date(value ?? Date.now()));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = value ? new Date(value) : null;

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [viewMonth]);

  function commit(next: Date) {
    onChange(next.getTime());
  }

  function pickDay(day: Date) {
    const base = selected ?? setMinutes(setHours(new Date(), 9), 0);
    const next = setMinutes(setHours(day, base.getHours()), base.getMinutes());
    commit(next);
  }

  function pickHour(hour: number) {
    commit(setHours(selected ?? new Date(), hour));
  }

  function pickMinute(minute: number) {
    commit(setMinutes(selected ?? new Date(), minute));
  }

  const currentHour = selected?.getHours() ?? 9;
  const currentMinute = selected?.getMinutes() ?? 0;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-left text-sm font-medium text-[var(--foreground)] shadow-sm transition",
          "hover:border-brand-400 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15",
          open && "border-brand-500 ring-4 ring-brand-500/15",
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-brand-600" />
        <span className={selected ? "" : "text-[var(--muted-foreground)]"}>
          {selected ? format(selected, "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr }) : placeholder}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-2 w-[20rem] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-strong)]">
          <div className="border-b border-[var(--border)] bg-[var(--accent)] px-3 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Date et heure</p>
            <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
              {selected ? format(selected, "EEEE d MMMM yyyy 'à' HH:mm", { locale: fr }) : "À définir"}
            </p>
          </div>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <button
              type="button"
              onClick={() => setViewMonth((current) => subMonths(current, 1))}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold capitalize text-[var(--foreground)]">
              {format(viewMonth, "MMMM yyyy", { locale: fr })}
            </span>
            <button
              type="button"
              onClick={() => setViewMonth((current) => addMonths(current, 1))}
              className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="px-3 pt-3">
            <div className="grid grid-cols-7 gap-1 pb-1">
              {WEEKDAYS.map((day) => (
                <span key={day} className="text-center text-[11px] font-bold uppercase text-[var(--muted-foreground)]">
                  {day}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const isSelected = selected && isSameDay(day, selected);
                const outside = !isSameMonth(day, viewMonth);
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    onClick={() => pickDay(day)}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-lg text-sm font-medium transition",
                      isSelected
                        ? "bg-brand-500 text-white"
                        : outside
                          ? "text-[var(--muted-foreground)]/50 hover:bg-[var(--accent)]"
                          : "text-[var(--foreground)] hover:bg-[var(--accent)]",
                      !isSelected && isToday(day) && "ring-1 ring-brand-400",
                    )}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 border-t border-[var(--border)] bg-[var(--accent)] px-3 py-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
              <Clock className="h-3.5 w-3.5 text-brand-600" />
              Heure
            </div>
            <div className="flex gap-2">
              <TimeColumn values={HOURS} selected={currentHour} suffix="h" onSelect={pickHour} />
              <TimeColumn values={MINUTES} selected={MINUTES.includes(currentMinute) ? currentMinute : 0} suffix="min" onSelect={pickMinute} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => { if (selected) { pickHour(8); commit(setMinutes(setHours(selected, 8), 0)); } }}
                className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm font-semibold text-[var(--foreground)] transition hover:border-brand-400"
              >
                8h00
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-9 flex-1 rounded-lg bg-brand-500 text-sm font-semibold text-white transition hover:bg-brand-600"
              >
                Valider
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TimeColumn({
  values,
  selected,
  suffix,
  onSelect,
}: {
  values: number[];
  selected: number;
  suffix: string;
  onSelect: (value: number) => void;
}) {
  return (
    <div className="thin-scroll max-h-32 flex-1 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
      {values.map((value) => {
        const isActive = value === selected;
        return (
          <button
            key={value}
            type="button"
            onClick={() => onSelect(value)}
            className={cn(
              "mb-0.5 w-full rounded-md px-2 py-1.5 text-center text-sm font-semibold transition",
              isActive ? "bg-brand-500 text-white" : "text-[var(--foreground)] hover:bg-[var(--accent)]",
            )}
          >
            {String(value).padStart(2, "0")}{suffix ? ` ${suffix}` : ""}
          </button>
        );
      })}
    </div>
  );
}
