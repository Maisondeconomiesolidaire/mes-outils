import { useId, useRef, useState } from "react";
import { Dialog, Select } from "radix-ui";
import { addMonths, eachDayOfInterval, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { fr } from "date-fns/locale";
import { BriefcaseBusiness, CalendarDays, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Search, UserRound, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/Button";

export type ReservationSearchValue = { start: number; end: number; usage: "pro" | "personal" };
type Dates = { start: string; end: string; startTime: string; endTime: string };
const EMPTY_DATES: Dates = { start: "", end: "", startTime: "09:00", endTime: "10:00" };
const HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

function timestamp(date: string, time: string) {
  return date ? new Date(`${date}T${time}:00`).getTime() : NaN;
}

export function ReservationSearch({ onSearch }: { onSearch: (value: ReservationSearchValue) => void }) {
  const datesButton = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState<"dates" | "usage" | null>(null);
  const [dates, setDates] = useState<Dates>(EMPTY_DATES);
  const [draft, setDraft] = useState<Dates>(EMPTY_DATES);
  const [usage, setUsage] = useState<"pro" | "personal" | null>(null);
  const [activeDate, setActiveDate] = useState<"start" | "end">("start");
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const today = format(new Date(), "yyyy-MM-dd");
  const start = timestamp(draft.start, draft.startTime);
  const end = timestamp(draft.end, draft.endTime);
  const complete = Boolean(draft.start && draft.end);
  // C'est la FIN qui doit être à venir, pas le début : réserver une salle
  // « aujourd'hui de 8h30 à 13h30 » reste légitime à 10h, et le serveur
  // l'accepte (il ne vérifie que début < fin). Exiger un début futur
  // interdisait toute réservation sur la demi-journée en cours.
  const valid = complete && end > start && end > Date.now();
  const error = !complete ? null : end <= start ? "La fin doit être après le début de la réservation."
    : end <= Date.now() ? "Ce créneau est déjà passé." : null;

  function openDates() {
    setDraft(dates);
    setActiveDate("start");
    setMonth(startOfMonth(dates.start ? new Date(`${dates.start}T12:00:00`) : new Date()));
    setStep("dates");
  }
  function selectDate(value: string, field = activeDate) {
    setDraft((current) => {
      if (field === "start") return { ...current, start: value, end: value };
      return { ...current, start: current.start || value, end: value };
    });
    if (value && field === "start") setActiveDate("end");
  }
  function search() {
    const from = timestamp(dates.start, dates.startTime);
    const to = timestamp(dates.end, dates.endTime);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to <= Date.now()) { openDates(); return; }
    if (!usage) { setStep("usage"); return; }
    onSearch({ start: from, end: to, usage });
    setStep(null);
  }

  const datesLabel = dates.start && dates.end
    ? `${format(new Date(`${dates.start}T12:00:00`), "dd MMM", { locale: fr })} · ${dates.startTime} → ${format(new Date(`${dates.end}T12:00:00`), "dd MMM", { locale: fr })} · ${dates.endTime}`
    : "Quand souhaitez-vous réserver ?";

  return (
    <Dialog.Root open={step !== null} onOpenChange={(open) => { if (!open) setStep(null); }}>
      <div className="mx-auto flex max-w-5xl flex-col gap-2 rounded-3xl border border-[var(--border)] bg-[var(--accent)] p-2 shadow-sm sm:flex-row sm:items-center sm:rounded-full">
        <button ref={datesButton} type="button" onClick={openDates} className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-full px-5 py-4 text-left transition hover:bg-[var(--card)] focus-visible:outline-brand-500", step === "dates" && "bg-[var(--card)] shadow-md")}>
          <CalendarDays className="h-5 w-5 shrink-0 text-brand-600" />
          <span className="min-w-0"><span className="block text-sm font-bold">1 · Dates et horaires</span><span className="block truncate text-sm text-[var(--muted-foreground)]">{datesLabel}</span></span>
        </button>
        <button type="button" onClick={() => setStep("usage")} className={cn("flex items-center gap-3 rounded-full px-5 py-4 text-left transition hover:bg-[var(--card)] focus-visible:outline-brand-500 sm:min-w-52", step === "usage" && "bg-[var(--card)] shadow-md")}>
          <BriefcaseBusiness className="h-5 w-5 shrink-0 text-brand-600" />
          <span><span className="block text-sm font-bold">2 · Usage</span><span className="block text-sm text-[var(--muted-foreground)]">{usage === "pro" ? "Professionnel" : usage === "personal" ? "Personnel" : "Pour quel usage ?"}</span></span>
        </button>
        <Button type="button" size="lg" className="h-14 rounded-full px-6" onClick={search}><Search className="h-5 w-5" />Rechercher</Button>
      </div>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-sm" />
        <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); datesButton.current?.focus(); }} aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[92svh] w-[calc(100%-1rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl bg-[var(--card)] text-[var(--foreground)] shadow-2xl outline-none sm:rounded-[2rem]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-8">
            <Dialog.Title className="text-lg font-bold">{step === "dates" ? "Quand souhaitez-vous réserver ?" : "Pour quel usage ?"}</Dialog.Title>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="sm" aria-label="Fermer"><X className="h-5 w-5" /></Button></Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-5 sm:p-8">
            <div className="mb-6 flex justify-center gap-2" aria-label="Étapes de la recherche">
              <button type="button" onClick={openDates} aria-current={step === "dates" ? "step" : undefined} className={cn("rounded-full px-5 py-2 text-sm font-semibold", step === "dates" ? "bg-[var(--foreground)] text-[var(--card)]" : "bg-[var(--accent)]")}>1 · Dates</button>
              <button type="button" disabled={step === "dates" && !valid} onClick={() => { if (step === "dates" && valid) setDates(draft); setStep("usage"); }} aria-current={step === "usage" ? "step" : undefined} className={cn("rounded-full px-5 py-2 text-sm font-semibold", step === "usage" ? "bg-[var(--foreground)] text-[var(--card)]" : "bg-[var(--accent)] disabled:opacity-40")}>2 · Usage</button>
            </div>
            {step === "dates" ? <>
              <div className="grid gap-4 sm:grid-cols-2">
                {(["start", "end"] as const).map((field) => <div key={field} className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
                  <label className={cn("min-w-0 rounded-2xl border-2 px-3 py-2", activeDate === field ? "border-brand-500" : "border-[var(--border)]")}>
                    <span className="mb-1 block text-xs font-semibold text-[var(--muted-foreground)]">Date de {field === "start" ? "début" : "fin"}</span>
                    <input aria-label={field === "start" ? "Date de début" : "Date de fin"} type="date" value={draft[field]} min={field === "end" ? draft.start || today : today} onFocus={() => setActiveDate(field)} onChange={(e) => selectDate(e.target.value, field)} className="w-full min-w-0 bg-transparent py-1 text-base font-semibold outline-none" />
                  </label>
                  <ReservationTimeSelect
                    label={field === "start" ? "Heure de début" : "Heure de fin"}
                    value={draft[field === "start" ? "startTime" : "endTime"]}
                    onChange={(value) => setDraft((current) => ({ ...current, [field === "start" ? "startTime" : "endTime"]: value }))}
                  />
                </div>)}
              </div>
              <div className="my-5 flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" aria-label="Mois précédent" disabled={month <= startOfMonth(new Date())} onClick={() => setMonth(addMonths(month, -1))}><ChevronLeft className="h-5 w-5" /></Button>
                <p className="text-center text-sm text-[var(--muted-foreground)]" aria-live="polite">Choisissez la date de {activeDate === "start" ? "début" : "fin"}</p>
                <Button type="button" variant="ghost" size="sm" aria-label="Mois suivant" onClick={() => setMonth(addMonths(month, 1))}><ChevronRight className="h-5 w-5" /></Button>
              </div>
              <div className="grid gap-8 md:grid-cols-2">
                {[month, addMonths(month, 1)].map((displayMonth) => <div key={displayMonth.getTime()}>
                  <h3 className="mb-5 text-center text-lg font-bold capitalize">{format(displayMonth, "MMMM yyyy", { locale: fr })}</h3>
                  <div className="grid grid-cols-7 text-center">
                    {["L", "M", "M", "J", "V", "S", "D"].map((day, i) => <span key={i} className="pb-3 text-xs font-semibold text-[var(--muted-foreground)]" aria-hidden="true">{day}</span>)}
                    {Array.from({ length: (displayMonth.getDay() + 6) % 7 }, (_, i) => <span key={`blank-${i}`} />)}
                    {eachDayOfInterval({ start: displayMonth, end: endOfMonth(displayMonth) }).map((day) => {
                      const value = format(day, "yyyy-MM-dd");
                      const endpoint = value === draft.start || value === draft.end;
                      const inRange = draft.start && draft.end && value >= draft.start && value <= draft.end;
                      const disabled = day < startOfDay(new Date()) || (activeDate === "end" && Boolean(draft.start) && value < draft.start);
                      return <button key={value} type="button" disabled={disabled} aria-label={format(day, "EEEE d MMMM yyyy", { locale: fr })} aria-pressed={endpoint} onClick={() => selectDate(value)} className={cn("flex h-11 items-center justify-center text-sm transition focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:text-[var(--muted-foreground)] disabled:opacity-35 sm:h-12", inRange && "bg-brand-500/10", endpoint ? "rounded-full bg-[var(--foreground)] font-bold text-[var(--card)]" : inRange ? "enabled:hover:bg-brand-500/20" : "rounded-lg enabled:hover:bg-[var(--accent)]")}>
                        {format(day, "d")}
                      </button>;
                    })}
                  </div>
                </div>)}
              </div>
              {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
            </> : <div className="grid gap-4 sm:grid-cols-2">
              {([{ value: "pro", label: "Professionnel", description: "Réunion, mission ou activité professionnelle.", Icon: BriefcaseBusiness }, { value: "personal", label: "Personnel", description: "Événement ou besoin personnel.", Icon: UserRound }] as const).map(({ value, label, description, Icon }) => <button key={value} type="button" aria-pressed={usage === value} onClick={() => setUsage(value)} className={cn("relative rounded-3xl border-2 p-6 text-left transition hover:border-brand-500", usage === value ? "border-brand-500 bg-brand-500/5" : "border-[var(--border)]")}>
                <Icon className="mb-5 h-8 w-8" />{usage === value && <Check className="absolute right-5 top-5 h-5 w-5 text-brand-600" />}<span className="block text-xl font-bold">{label}</span><span className="mt-2 block text-sm text-[var(--muted-foreground)]">{description}</span>
              </button>)}
            </div>}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4 sm:px-8">
            {step === "dates" ? <>
              <Button type="button" variant="ghost" onClick={() => { setDraft(EMPTY_DATES); setActiveDate("start"); }}>Effacer les dates</Button>
              <Button type="button" className="rounded-full px-6" disabled={!valid} onClick={() => { setDates(draft); setStep("usage"); }}>Confirmer <ChevronRight className="h-4 w-4" /></Button>
            </> : <>
              <Button type="button" variant="ghost" onClick={openDates}><ChevronLeft className="h-4 w-4" />Retour</Button>
              <Button type="button" className="rounded-full px-6" disabled={!usage} onClick={search}><Search className="h-4 w-4" />Rechercher</Button>
            </>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ReservationTimeSelect({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="rounded-2xl border border-[var(--border)] px-2 py-2 focus-within:border-brand-500">
      <span id={labelId} className="mb-1 block text-xs text-[var(--muted-foreground)]">{label}</span>
      <Select.Root value={value} onValueChange={onChange}>
        <Select.Trigger aria-labelledby={labelId} className="flex w-full items-center justify-between gap-1 rounded-lg py-1 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          <Select.Value />
          <Select.Icon><ChevronDown className="h-4 w-4" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content position="popper" sideOffset={8} collisionPadding={12} className="z-[60] max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] shadow-xl">
            <Select.ScrollUpButton className="flex items-center justify-center py-1"><ChevronUp className="h-4 w-4" /></Select.ScrollUpButton>
            <Select.Viewport className="p-1.5">
              {HOURS.map((hour) => (
                <Select.Item key={hour} value={hour} className="relative flex cursor-pointer select-none items-center rounded-lg py-2.5 pl-3 pr-8 text-sm outline-none data-[highlighted]:bg-[var(--accent)] data-[state=checked]:bg-brand-500/10 data-[state=checked]:font-semibold data-[state=checked]:text-brand-700">
                  <Select.ItemText>{hour}</Select.ItemText>
                  <Select.ItemIndicator className="absolute right-2"><Check className="h-4 w-4" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="flex items-center justify-center py-1"><ChevronDown className="h-4 w-4" /></Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
