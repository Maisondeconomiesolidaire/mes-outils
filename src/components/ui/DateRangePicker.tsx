import { format, isSameDay, setHours, setMinutes } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { CalendarBoard } from "./CalendarBoard";

const TIME_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const minutes = 7 * 60 + index * 30;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

export type DateRange = { start: number | null; end: number | null };
type TimeValue = { h: number; m: number };

export function DateRangePicker({
  value,
  onChange,
  withTime = true,
  placeholder = "Choisir les dates",
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  withTime?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"start" | "end">("start");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 720 });

  const [startDay, setStartDay] = useState<Date | null>(value.start ? new Date(value.start) : null);
  const [endDay, setEndDay] = useState<Date | null>(value.end ? new Date(value.end) : null);
  const [startTime, setStartTime] = useState<TimeValue>({
    h: value.start ? new Date(value.start).getHours() : 9,
    m: value.start ? new Date(value.start).getMinutes() : 0,
  });
  const [endTime, setEndTime] = useState<TimeValue>({
    h: value.end ? new Date(value.end).getHours() : 10,
    m: value.end ? new Date(value.end).getMinutes() : 0,
  });

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(720, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 620);
    setPosition({ top: Math.max(12, top), left, width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onClick(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function emit(nextStartDay = startDay, nextEndDay = endDay, nextStartTime = startTime, nextEndTime = endTime) {
    if (!nextStartDay || !nextEndDay) {
      onChange({ start: null, end: null });
      return;
    }
    const start = withTime
      ? setMinutes(setHours(nextStartDay, nextStartTime.h), nextStartTime.m)
      : new Date(nextStartDay.getFullYear(), nextStartDay.getMonth(), nextStartDay.getDate(), 0, 0, 0, 0);
    let end = withTime
      ? setMinutes(setHours(nextEndDay, nextEndTime.h), nextEndTime.m)
      : new Date(nextEndDay.getFullYear(), nextEndDay.getMonth(), nextEndDay.getDate(), 23, 59, 0, 0);
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
      setEndDay(end);
      setEndTime({ h: end.getHours(), m: end.getMinutes() });
    }
    onChange({ start: start.getTime(), end: end.getTime() });
  }

  function selectDay(day: Date) {
    if (step === "start") {
      setStartDay(day);
      if (!endDay || day.getTime() > endDay.getTime()) setEndDay(day);
      return;
    }
    setEndDay(day);
    emit(startDay, day, startTime, endTime);
  }

  function selectStartTime(time: TimeValue) {
    setStartTime(time);
    const nextEndDay = endDay ?? startDay;
    if (startDay && nextEndDay) emit(startDay, nextEndDay, time, endTime);
    // L'utilisateur passe à l'étape « Fin » via le bouton Suivant (wizard explicite).
  }

  function selectEndTime(time: TimeValue) {
    setEndTime(time);
    emit(startDay, endDay ?? startDay, startTime, time);
  }

  const label = value.start && value.end ? rangeLabel(value, withTime) : placeholder;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setStep("start");
        }}
        className={cn(
          "flex h-11 w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-left text-sm font-medium text-[var(--foreground)] transition",
          "hover:border-brand-400 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/15",
          open && "border-brand-500 ring-4 ring-brand-500/15",
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-brand-600" />
        <span className={value.start ? "" : "text-[var(--muted-foreground)]"}>{label}</span>
      </button>

      {open ? (
        <div
          ref={popoverRef}
          className="fixed z-[80] overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-strong)]"
          style={{ top: position.top, left: position.left, width: position.width }}
        >
          <div className="border-b border-[var(--border)] p-4">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              <span className="inline-flex h-5 items-center rounded-full bg-brand-500 px-2 text-[11px] text-white">
                Étape {step === "start" ? "1" : "2"} / 2
              </span>
              {step === "start" ? "Date et heure de début" : "Date et heure de fin"}
            </div>
            <div className="flex items-center gap-3">
              <StepButton active={step === "start"} label="1. Début" value={startDay ? formatStep(startDay, startTime, withTime) : "À définir"} onClick={() => setStep("start")} />
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
              <StepButton active={step === "end"} label="2. Fin" value={endDay ? formatStep(endDay, endTime, withTime) : "À définir"} onClick={() => setStep("end")} />
            </div>
          </div>

          <div className="grid transition-transform duration-300 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="p-4">
              <CalendarBoard
                selected={(step === "start" ? startDay : endDay)?.getTime() ?? null}
                rangeStart={startDay?.getTime() ?? null}
                rangeEnd={endDay?.getTime() ?? null}
                onSelect={selectDay}
                compact
              />
            </div>
            <div className="border-t border-[var(--border)] bg-[var(--accent)] p-4 lg:border-l lg:border-t-0">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                <Clock className="h-3.5 w-3.5 text-brand-600" />
                {step === "start" ? "Heure de début" : "Heure de fin"}
              </div>
              {withTime ? (
                <TimeGrid value={step === "start" ? startTime : endTime} onChange={step === "start" ? selectStartTime : selectEndTime} />
              ) : (
                <p className="rounded-xl bg-[var(--card)] p-3 text-sm text-[var(--muted-foreground)]">
                  Journée complète.
                </p>
              )}
              <div className="mt-4 flex gap-2">
                {step === "start" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setStartDay(null);
                        setEndDay(null);
                        onChange({ start: null, end: null });
                      }}
                      className="h-10 flex-1 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm font-semibold text-[var(--foreground)]"
                    >
                      Effacer
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep("end")}
                      disabled={!startDay}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Suivant
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setStep("start")}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm font-semibold text-[var(--foreground)]"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Précédent
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      disabled={!value.start || !value.end}
                      className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      Valider
                    </button>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3 rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepButton({ active, label, value, onClick }: { active: boolean; label: string; value: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col rounded-2xl border px-4 py-3 text-left transition",
        active
          ? "border-brand-500 bg-brand-50 text-brand-900"
          : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]",
      )}
    >
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</span>
      <span className="mt-1 truncate text-sm font-semibold">{value}</span>
    </button>
  );
}

function TimeGrid({ value, onChange }: { value: TimeValue; onChange: (value: TimeValue) => void }) {
  const current = formatTime(value);
  return (
    <div className="grid max-h-[360px] grid-cols-3 gap-2 overflow-y-auto pr-1">
      {TIME_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(parseTime(option))}
          className={cn(
            "rounded-xl px-2 py-2 text-sm font-bold transition",
            option === current
              ? "bg-brand-500 text-white shadow-sm"
              : "bg-[var(--card)] text-[var(--foreground)] hover:bg-brand-50 hover:text-brand-800",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function parseTime(value: string): TimeValue {
  const [h, m] = value.split(":").map(Number);
  return { h, m };
}

function formatTime(value: TimeValue) {
  return `${String(value.h).padStart(2, "0")}:${String(value.m).padStart(2, "0")}`;
}

function formatStep(day: Date, time: TimeValue, withTime: boolean) {
  return withTime
    ? `${format(day, "d MMM", { locale: fr })} · ${formatTime(time)}`
    : format(day, "d MMM yyyy", { locale: fr });
}

function rangeLabel(value: DateRange, withTime: boolean) {
  if (!value.start || !value.end) return "";
  const start = new Date(value.start);
  const end = new Date(value.end);
  const dateLabel = isSameDay(start, end)
    ? format(start, "d MMM", { locale: fr })
    : `${format(start, "d MMM", { locale: fr })} → ${format(end, "d MMM", { locale: fr })}`;
  if (!withTime) return dateLabel;
  return `${dateLabel} · ${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
}
