import { format, isSameDay, setHours, setMinutes } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeft, ArrowRight, CalendarDays, Check, X } from "lucide-react";
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
type WizardStep = "startDate" | "startTime" | "endDate" | "endTime";

const WIZARD_STEPS: Array<{ key: WizardStep; label: string }> = [
  { key: "startDate", label: "Date début" },
  { key: "startTime", label: "Heure début" },
  { key: "endDate", label: "Date fin" },
  { key: "endTime", label: "Heure fin" },
];

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
  const [step, setStep] = useState<WizardStep>("startDate");
  const [maxVisitedStep, setMaxVisitedStep] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 520, mobile: false });

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

  useEffect(() => {
    if (value.start) {
      const nextStart = new Date(value.start);
      setStartDay(nextStart);
      setStartTime({ h: nextStart.getHours(), m: nextStart.getMinutes() });
    }
    if (value.end) {
      const nextEnd = new Date(value.end);
      setEndDay(nextEnd);
      setEndTime({ h: nextEnd.getHours(), m: nextEnd.getMinutes() });
    }
  }, [value.start, value.end]);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const mobile = window.innerWidth < 640;
    if (mobile) {
      setPosition({ top: 0, left: 0, width: window.innerWidth, mobile: true });
      return;
    }
    const width = Math.min(520, window.innerWidth - 24);
    const left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    const top = Math.min(rect.bottom + 8, window.innerHeight - 620);
    setPosition({ top: Math.max(12, top), left, width, mobile: false });
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

  function buildRange(nextStartDay = startDay, nextEndDay = endDay, nextStartTime = startTime, nextEndTime = endTime) {
    if (!nextStartDay || !nextEndDay) {
      return { range: { start: null, end: null }, adjustedEnd: null };
    }
    const start = withTime
      ? setMinutes(setHours(nextStartDay, nextStartTime.h), nextStartTime.m)
      : new Date(nextStartDay.getFullYear(), nextStartDay.getMonth(), nextStartDay.getDate(), 0, 0, 0, 0);
    let end = withTime
      ? setMinutes(setHours(nextEndDay, nextEndTime.h), nextEndTime.m)
      : new Date(nextEndDay.getFullYear(), nextEndDay.getMonth(), nextEndDay.getDate(), 23, 59, 0, 0);
    let adjustedEnd: Date | null = null;
    if (end.getTime() <= start.getTime()) {
      end = new Date(start.getTime() + 60 * 60 * 1000);
      adjustedEnd = end;
    }
    return { range: { start: start.getTime(), end: end.getTime() }, adjustedEnd };
  }

  function emit(nextStartDay = startDay, nextEndDay = endDay, nextStartTime = startTime, nextEndTime = endTime) {
    const { range, adjustedEnd } = buildRange(nextStartDay, nextEndDay, nextStartTime, nextEndTime);
    if (adjustedEnd) {
      setEndDay(adjustedEnd);
      setEndTime({ h: adjustedEnd.getHours(), m: adjustedEnd.getMinutes() });
    }
    onChange(range);
  }

  function selectDay(day: Date) {
    if (step === "startDate") {
      setStartDay(day);
      const nextEndDay = !endDay || day.getTime() > endDay.getTime() ? day : endDay;
      if (nextEndDay !== endDay) setEndDay(nextEndDay);
      emit(day, nextEndDay, startTime, endTime);
      return;
    }
    if (startDay && day.getTime() < startOfDate(startDay).getTime()) return;
    setEndDay(day);
    emit(startDay, day, startTime, endTime);
  }

  function selectStartTime(time: TimeValue) {
    setStartTime(time);
    const nextEndDay = endDay ?? startDay;
    if (startDay && nextEndDay) emit(startDay, nextEndDay, time, endTime);
  }

  function selectEndTime(time: TimeValue) {
    if (isEndTimeDisabled(time)) return;
    setEndTime(time);
    emit(startDay, endDay ?? startDay, startTime, time);
  }

  const label = value.start && value.end ? rangeLabel(value, withTime) : placeholder;
  const currentStepIndex = WIZARD_STEPS.findIndex((item) => item.key === step);
  const activeTitle = stepTitle(step);
  const canGoNext = canContinue(step, startDay, endDay);
  const canValidate = Boolean(value.start && value.end);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          setStep("startDate");
          setMaxVisitedStep(value.start && value.end ? WIZARD_STEPS.length - 1 : 0);
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
          className={cn(
            "fixed z-[80] overflow-hidden border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-strong)]",
            position.mobile ? "inset-x-0 bottom-0 max-h-[92vh] overflow-y-auto rounded-t-3xl" : "rounded-3xl",
          )}
          style={
            position.mobile
              ? { width: "100%" }
              : { top: position.top, left: position.left, width: position.width }
          }
        >
          <div className="border-b border-[var(--border)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                  Étape {currentStepIndex + 1} / 4
                </p>
                <p className="mt-1 text-base font-semibold text-[var(--foreground)]">{activeTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
                aria-label="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {WIZARD_STEPS.map((item, index) => (
                <span
                  key={item.key}
                  className={cn(
                    "h-1.5 rounded-full bg-[var(--accent)]",
                    item.key === step && "bg-brand-500",
                    index < currentStepIndex && "bg-[var(--selected-foreground)]",
                  )}
                  title={item.label}
                />
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <SummaryItem
                active={step === "startDate"}
                label="Date début"
                value={startDay ? format(startDay, "d MMM yyyy", { locale: fr }) : "À choisir"}
              />
              <SummaryItem
                active={step === "startTime"}
                label="Heure début"
                value={startDay && maxVisitedStep >= 1 ? formatTime(startTime) : "À choisir"}
              />
              <SummaryItem
                active={step === "endDate"}
                label="Date fin"
                value={endDay && maxVisitedStep >= 2 ? format(endDay, "d MMM yyyy", { locale: fr }) : "À choisir"}
              />
              <SummaryItem
                active={step === "endTime"}
                label="Heure fin"
                value={endDay && maxVisitedStep >= 3 ? formatTime(endTime) : "À choisir"}
              />
            </div>
          </div>

          <div className="p-4">
            {step === "startDate" ? (
              <CalendarBoard
                selected={startDay?.getTime() ?? null}
                rangeStart={startDay?.getTime() ?? null}
                rangeEnd={endDay?.getTime() ?? null}
                onSelect={selectDay}
                compact
              />
            ) : null}
            {step === "startTime" ? <TimeGrid value={startTime} onChange={selectStartTime} /> : null}
            {step === "endDate" ? (
              <CalendarBoard
                selected={endDay?.getTime() ?? null}
                rangeStart={startDay?.getTime() ?? null}
                rangeEnd={endDay?.getTime() ?? null}
                onSelect={selectDay}
                compact
                disabledBefore={startDay?.getTime() ?? null}
              />
            ) : null}
            {step === "endTime" ? (
              withTime ? (
                <TimeGrid value={endTime} onChange={selectEndTime} isDisabled={isEndTimeDisabled} />
              ) : (
                <p className="rounded-xl bg-[var(--accent)] p-3 text-sm text-[var(--muted-foreground)]">
                  Journée complète.
                </p>
              )
            ) : null}
          </div>

          <div className="border-t border-[var(--border)] bg-[var(--accent)] p-4">
            <div className="flex gap-2">
              {currentStepIndex > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep(WIZARD_STEPS[currentStepIndex - 1].key)}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm font-semibold text-[var(--foreground)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Retour
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStartDay(null);
                    setEndDay(null);
                    onChange({ start: null, end: null });
                    setStep("startDate");
                    setMaxVisitedStep(0);
                  }}
                  className="h-10 flex-1 rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm font-semibold text-[var(--foreground)]"
                >
                  Effacer
                </button>
              )}
              {currentStepIndex < WIZARD_STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    const nextIndex = currentStepIndex + 1;
                    setMaxVisitedStep((current) => Math.max(current, nextIndex));
                    setStep(WIZARD_STEPS[nextIndex].key);
                  }}
                  disabled={!canGoNext}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Suivant
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={!canValidate}
                  className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Check className="h-4 w-4" />
                  Valider
                </button>
              )}
            </div>
            {currentStepIndex > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setStartDay(null);
                  setEndDay(null);
                  onChange({ start: null, end: null });
                  setStep("startDate");
                  setMaxVisitedStep(0);
                }}
                className="mt-2 h-9 w-full rounded-xl border border-[var(--border)] bg-[var(--card)] text-sm font-semibold text-[var(--foreground)]"
              >
                Effacer
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );

  function isEndTimeDisabled(time: TimeValue) {
    if (!startDay || !endDay || !isSameDay(startDay, endDay)) return false;
    const startMinutes = startTime.h * 60 + startTime.m;
    const endMinutes = time.h * 60 + time.m;
    return endMinutes <= startMinutes;
  }
}

function TimeGrid({
  value,
  onChange,
  isDisabled,
}: {
  value: TimeValue;
  onChange: (value: TimeValue) => void;
  isDisabled?: (value: TimeValue) => boolean;
}) {
  const current = formatTime(value);
  return (
    <div className="thin-scroll grid max-h-[360px] grid-cols-2 gap-2.5 overflow-y-auto pr-1">
      {TIME_OPTIONS.map((option) => {
        const time = parseTime(option);
        const disabled = isDisabled?.(time) ?? false;
        return (
          <button
            key={option}
            type="button"
            onClick={() => {
              if (!disabled) onChange(time);
            }}
            disabled={disabled}
            className={cn(
              "rounded-xl px-3 py-2.5 text-[15px] font-bold tracking-wide transition",
              option === current
                ? "bg-brand-500 text-white shadow-sm"
                : "bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--selected)] hover:text-[var(--selected-foreground)]",
              disabled && "cursor-not-allowed opacity-35 hover:bg-[var(--card)] hover:text-[var(--foreground)]",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function SummaryItem({ active, label, value }: { active: boolean; label: string; value: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--accent)] px-3 py-2",
        active && "border-brand-500 bg-[var(--selected)] ring-2 ring-brand-500/15",
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-[var(--foreground)]">{value}</p>
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

function rangeLabel(value: DateRange, withTime: boolean) {
  if (!value.start || !value.end) return "";
  const start = new Date(value.start);
  const end = new Date(value.end);
  const dateLabel = isSameDay(start, end)
    ? format(start, "EEEE d MMMM", { locale: fr })
    : `${format(start, "d MMM", { locale: fr })} → ${format(end, "d MMM", { locale: fr })}`;
  if (!withTime) return dateLabel;
  return `${dateLabel} · ${format(start, "HH:mm")}–${format(end, "HH:mm")}`;
}

function startOfDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function stepTitle(step: WizardStep) {
  const titles: Record<WizardStep, string> = {
    startDate: "Choisissez la date de début",
    startTime: "Choisissez l'heure de début",
    endDate: "Choisissez la date de fin",
    endTime: "Choisissez l'heure de fin",
  };
  return titles[step];
}

function canContinue(step: WizardStep, startDay: Date | null, endDay: Date | null) {
  if (step === "startDate" || step === "startTime") return Boolean(startDay);
  if (step === "endDate") return Boolean(startDay && endDay);
  return true;
}
