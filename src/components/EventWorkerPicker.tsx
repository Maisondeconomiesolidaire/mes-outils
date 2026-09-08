import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { Check, Search, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { FullSpinner } from "./ui/Spinner";
import { cn } from "../lib/cn";

type Worker = NonNullable<ReturnType<typeof useQuery<typeof api.community.eventWorkers>>>[number];

/** Heures affichées à l'unité près quand c'est rond, sinon avec une décimale. */
function hours(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1).replace(".", ",")} h`;
}

/** Part de la semaine d'un salarié que représente l'évènement. */
function allocation(eventHours: number, weekly: number | null) {
  if (!weekly || eventHours <= 0) return null;
  return Math.round((eventHours / weekly) * 100);
}

/** Case à cocher dessinée : le rendu natif jure avec le reste du formulaire. */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
        checked
          ? "border-brand-500 bg-brand-500 text-white"
          : "border-[var(--border)] bg-[var(--input)]",
      )}
    >
      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * Salariés mobilisés sur un évènement, comme dans le calendrier de la
 * Recyclerie : sélection multiple, recherche, et part de semaine que
 * l'évènement représente pour chacun.
 */
export function EventWorkerPicker({
  value,
  onChange,
  eventHours,
}: {
  value: Id<"polyvalentWorkers">[];
  onChange: (next: Id<"polyvalentWorkers">[]) => void;
  eventHours: number;
}) {
  const workers = useQuery(api.community.eventWorkers, {});
  const [open, setOpen] = useState(false);

  const selectedNames = (workers ?? [])
    .filter((worker) => value.includes(worker._id))
    .map((worker) => worker.name);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--input)] px-3 text-left text-sm transition hover:border-brand-400"
      >
        <span
          className={cn("truncate", value.length === 0 && "text-[var(--muted-foreground)]")}
        >
          {value.length === 0 ? "Aucun salarié" : selectedNames.join(", ")}
        </span>
        <Users className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
      </button>

      {open ? (
        <WorkerPickerModal
          workers={workers}
          value={value}
          eventHours={eventHours}
          onClose={() => setOpen(false)}
          onValidate={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function WorkerPickerModal({
  workers,
  value,
  eventHours,
  onClose,
  onValidate,
}: {
  workers: Worker[] | undefined;
  value: Id<"polyvalentWorkers">[];
  eventHours: number;
  onClose: () => void;
  onValidate: (next: Id<"polyvalentWorkers">[]) => void;
}) {
  const [selected, setSelected] = useState(value);
  const [search, setSearch] = useState("");

  // La dépendance porte sur les identifiants et non sur le tableau : le parent
  // en reconstruit un à chaque rendu, ce qui écraserait les cases cochées.
  const valueKey = value.join(",");
  useEffect(() => {
    setSelected(valueKey ? (valueKey.split(",") as Id<"polyvalentWorkers">[]) : []);
  }, [valueKey]);

  const needle = search.trim().toLocaleLowerCase("fr-FR");
  const visible = (workers ?? []).filter(
    (worker) =>
      !needle ||
      `${worker.name} ${worker.email ?? ""}`.toLocaleLowerCase("fr-FR").includes(needle),
  );

  return (
    <Modal open onClose={onClose} title="Salariés mobilisés">
      <div className="space-y-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher un salarié…"
            className="h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] pl-9 pr-3 text-sm"
          />
        </div>

        {workers === undefined ? (
          <FullSpinner label="Chargement de l'équipe..." />
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
            Aucun salarié ne correspond à cette recherche.
          </p>
        ) : (
          <div className="grid max-h-[50vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {visible.map((worker) => {
              const checked = selected.includes(worker._id);
              const percent = allocation(eventHours, worker.weeklyHours);
              return (
                <button
                  key={worker._id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() =>
                    setSelected((current) =>
                      current.includes(worker._id)
                        ? current.filter((id) => id !== worker._id)
                        : [...current, worker._id],
                    )
                  }
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                    checked
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                      : "border-[var(--border)] bg-[var(--card)] hover:border-brand-400",
                  )}
                >
                  <CheckMark checked={checked} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{worker.name}</span>
                    <span className="block truncate text-xs text-[var(--muted-foreground)]">
                      {worker.sites?.length ? `Recyclerie ${worker.sites.join(" · ")}` : "—"}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-[var(--muted-foreground)]">
                    <span className="block">
                      {worker.weeklyHours ? `${hours(worker.weeklyHours)}/sem.` : "durée inconnue"}
                    </span>
                    {percent !== null ? (
                      <span className="block font-semibold text-brand-600">{percent} %</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            {selected.length === 0
              ? "Aucun salarié sélectionné"
              : `${selected.length} salarié${selected.length > 1 ? "s" : ""} sélectionné${selected.length > 1 ? "s" : ""}`}
            {eventHours > 0 ? ` · évènement de ${hours(eventHours)}` : ""}
          </p>
          <div className="flex gap-2">
            {selected.length > 0 ? (
              <Button variant="outline" onClick={() => setSelected([])}>
                Tout décocher
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button onClick={() => onValidate(selected)}>Valider</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
