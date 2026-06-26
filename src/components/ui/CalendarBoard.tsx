import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { fr } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";

const WEEKDAYS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];

export type CalendarEvent = {
  id: string;
  start: number;
  end?: number;
  title: string;
  subtitle?: string;
  tone?: "brand" | "amber" | "rose" | "sky" | "zinc";
};

export function CalendarBoard({
  selected,
  rangeStart,
  rangeEnd,
  events = [],
  onSelect,
  onEventClick,
  compact = false,
}: {
  selected?: number | null;
  rangeStart?: number | null;
  rangeEnd?: number | null;
  events?: CalendarEvent[];
  onSelect?: (day: Date) => void;
  onEventClick?: (id: string) => void;
  compact?: boolean;
}) {
  const [viewMonth, setViewMonth] = useState(() => new Date(selected ?? rangeStart ?? Date.now()));
  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 1 }),
        end: endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 1 }),
      }),
    [viewMonth],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = format(new Date(event.start), "yyyy-MM-dd");
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <button
          type="button"
          onClick={() => setViewMonth((current) => subMonths(current, 1))}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-sm font-semibold capitalize text-[var(--foreground)]">
          {format(viewMonth, "MMMM yyyy", { locale: fr })}
        </p>
        <button
          type="button"
          onClick={() => setViewMonth((current) => addMonths(current, 1))}
          className="rounded-lg p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px border-b border-[var(--border)] bg-[var(--border)]">
        {WEEKDAYS.map((day) => (
          <span
            key={day}
            className="bg-[var(--card)] py-2 text-center text-[10px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]"
          >
            {day}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-[var(--border)]">
        {days.map((day) => {
          const dayKey = format(day, "yyyy-MM-dd");
          const dayEvents = eventsByDay.get(dayKey) ?? [];
          const outside = !isSameMonth(day, viewMonth);
          const isSelected = selected ? isSameDay(day, new Date(selected)) : false;
          const inRange =
            rangeStart && rangeEnd
              ? isWithinInterval(day, {
                  start: new Date(rangeStart),
                  end: new Date(rangeEnd),
                })
              : false;

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect?.(day)}
              className={cn(
                "min-h-16 bg-[var(--card)] p-1.5 text-left transition hover:bg-[var(--accent)]",
                compact ? "min-h-12" : "sm:min-h-24",
                outside && "text-[var(--muted-foreground)]/45",
                isSelected && "bg-[var(--selected)] ring-2 ring-inset ring-brand-500",
                !isSelected && inRange && "bg-[var(--selected)]",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                  isSelected ? "bg-brand-500 text-white" : "text-[var(--foreground)]",
                )}
              >
                {format(day, "d")}
              </span>
              {dayEvents.length > 0 ? (
                <div className="mt-1 space-y-1">
                  {dayEvents.slice(0, compact ? 2 : 3).map((event) => (
                    <span
                      key={event.id}
                      role={onEventClick ? "button" : undefined}
                      tabIndex={onEventClick ? 0 : undefined}
                      onClick={
                        onEventClick
                          ? (e) => {
                              e.stopPropagation();
                              onEventClick(event.id);
                            }
                          : undefined
                      }
                      onKeyDown={
                        onEventClick
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                onEventClick(event.id);
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        "block truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                        toneClass(event.tone),
                        onEventClick && "cursor-pointer hover:opacity-80",
                      )}
                    >
                      {event.title}
                    </span>
                  ))}
                  {dayEvents.length > (compact ? 2 : 3) ? (
                    <span className="block text-[10px] font-semibold text-[var(--muted-foreground)]">
                      +{dayEvents.length - (compact ? 2 : 3)}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toneClass(tone: CalendarEvent["tone"] = "brand") {
  const map = {
    brand: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    rose: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
    sky: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200",
  };
  return map[tone];
}
