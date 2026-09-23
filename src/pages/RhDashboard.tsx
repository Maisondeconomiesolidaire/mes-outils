import { useAction, useQuery } from "convex/react";
import { ArrowDownUp, ChevronDown, Loader2, MapPin, Navigation, Search, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input, Select } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { FullSpinner } from "../components/ui/Spinner";
import { EmployeeMap } from "../components/rh/EmployeeMap";
import { cn } from "../lib/cn";

type DashboardEmployee = {
  _id: Id<"hrEmployees">;
  fullName: string;
  address: string;
  structure: string;
  active: boolean;
  commuteDistanceKm?: number;
  commuteDurationMinutes?: number;
  commuteLongitude?: number;
  commuteLatitude?: number;
};

type Distance = { distanceKm?: number; durationMinutes?: number; error?: string };

const STRUCTURE_ORDER = [
  "Pays de Bray Emploi",
  "Pays de Bray Services 60",
  "Pays de Bray Services 76",
  "Recyclerie 60",
  "Recyclerie 76",
  "Les Sens du Bray",
  "Maison d'Economie Solidaire",
];

/** Tableau de bord RH, protégé par un droit de lecture distinct des contrats. */
export function RhDashboard() {
  const employees = useQuery(api.rh.listDashboardEmployees) as DashboardEmployee[] | undefined;
  const calculateDistances = useAction(api.rh.calculateDashboardDistances);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [distances, setDistances] = useState<Record<string, Distance>>({});
  const [calculating, setCalculating] = useState(false);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [mapEmployee, setMapEmployee] = useState<DashboardEmployee | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeSort, setEmployeeSort] = useState<"structure" | "distance_desc">("structure");

  const groups = useMemo(() => {
    const normalizedSearch = employeeSearch.trim().toLocaleLowerCase("fr");
    const visibleEmployees = normalizedSearch
      ? (employees ?? []).filter((employee) => employee.fullName.toLocaleLowerCase("fr").includes(normalizedSearch))
      : employees ?? [];
    const byStructure = new Map<string, DashboardEmployee[]>();
    for (const employee of visibleEmployees) {
      const current = byStructure.get(employee.structure) ?? [];
      current.push(employee);
      byStructure.set(employee.structure, current);
    }
    return [...byStructure.entries()]
      .sort(([left], [right]) => {
        const leftIndex = STRUCTURE_ORDER.indexOf(left);
        const rightIndex = STRUCTURE_ORDER.indexOf(right);
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex) || left.localeCompare(right, "fr");
      })
      .map(([structure, people]) => ({
        structure,
        people: [...people].sort((left, right) => {
          if (employeeSort === "distance_desc") {
            const leftDistance = distanceFor(left)?.distanceKm ?? Number.NEGATIVE_INFINITY;
            const rightDistance = distanceFor(right)?.distanceKm ?? Number.NEGATIVE_INFINITY;
            return rightDistance - leftDistance || left.fullName.localeCompare(right.fullName, "fr");
          }
          return left.fullName.localeCompare(right.fullName, "fr");
        }),
      }));
  }, [distances, employeeSearch, employeeSort, employees]);

  if (employees === undefined) {
    return <FullSpinner label="Chargement du tableau de bord RH..." />;
  }

  async function calculateAllDistances() {
    setCalculating(true);
    setDistanceError(null);
    try {
      const results = await calculateDistances({});
      setDistances(Object.fromEntries(results.map((result) => [result.employeeId, result])));
    } catch (error) {
      setDistanceError(error instanceof Error ? error.message : "Calcul des distances impossible.");
    } finally {
      setCalculating(false);
    }
  }

  function toggleStructure(structure: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      next.has(structure) ? next.delete(structure) : next.add(structure);
      return next;
    });
  }

  function distanceFor(employee: DashboardEmployee): Distance | undefined {
    return distances[employee._id] ?? (employee.commuteDistanceKm !== undefined
      ? { distanceKm: employee.commuteDistanceKm, durationMinutes: employee.commuteDurationMinutes }
      : undefined);
  }

  const mapDistance = mapEmployee ? distanceFor(mapEmployee) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button onClick={() => void calculateAllDistances()} disabled={calculating || employees.length === 0}>
          {calculating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
          {calculating ? "Calcul des distances..." : "Calculer les distances"}
        </Button>
      </div>

      <EmployeeMap employees={employees} />

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input
            className="pl-9"
            value={employeeSearch}
            onChange={(event) => setEmployeeSearch(event.target.value)}
            placeholder="Rechercher un salarié…"
            aria-label="Rechercher un salarié"
          />
        </div>
        <div className="relative sm:w-64">
          <ArrowDownUp className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Select className="pl-9" value={employeeSort} onChange={(event) => setEmployeeSort(event.target.value as "structure" | "distance_desc")} aria-label="Trier la liste des salariés">
            <option value="structure">Trier par nom</option>
            <option value="distance_desc">Distance décroissante</option>
          </Select>
        </div>
      </div>

      {distanceError ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {distanceError}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <EmptyState icon={<UsersRound className="h-8 w-8" />} title={employeeSearch ? "Aucun salarié trouvé" : "Aucun salarié"} description={employeeSearch ? "Essayez avec un autre nom." : "Les salariés ajoutés dans la gestion RH apparaîtront ici."} />
      ) : (
        <div className="space-y-4">
          {groups.map(({ structure, people }) => {
            const isCollapsed = collapsed.has(structure);
            return (
              <section key={structure} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
                <button
                  type="button"
                  onClick={() => toggleStructure(structure)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[var(--accent)]"
                >
                  <span>
                    <span className="block text-lg font-extrabold tracking-tight text-[var(--foreground)] sm:text-xl">{structure}</span>
                    <span className="mt-0.5 block text-sm text-[var(--muted-foreground)]">{people.length} salarié{people.length > 1 ? "s" : ""}</span>
                  </span>
                  <ChevronDown className={cn("h-5 w-5 text-[var(--muted-foreground)] transition-transform", isCollapsed && "-rotate-90")} />
                </button>
                {!isCollapsed ? (
                  <div className="border-t border-[var(--border)] px-5 py-2">
                    {people.map((employee) => {
                      const distance = distanceFor(employee);
                      return (
                        <article key={employee._id} className="flex flex-col gap-3 border-b border-[var(--border)] py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="font-semibold text-[var(--foreground)]">{employee.fullName}</p>
                            <button type="button" onClick={() => setMapEmployee(employee)} className="mt-1 flex max-w-full items-center gap-1.5 text-left text-sm text-[var(--muted-foreground)] transition hover:text-brand-600">
                              <MapPin className="h-4 w-4 shrink-0" />
                              <span className="truncate">{employee.address || "Adresse à compléter"}</span>
                            </button>
                            {!employee.active ? <span className="mt-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">Ancien salarié</span> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2 text-sm">
                            {distance?.distanceKm !== undefined ? (
                              <span className="rounded-full bg-brand-500/10 px-3 py-1.5 font-semibold text-brand-700 dark:text-brand-300">
                                {distance.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km
                                {distance.durationMinutes !== undefined ? <span className="ml-1.5 font-normal text-[var(--muted-foreground)]">· {distance.durationMinutes} min</span> : null}
                              </span>
                            ) : distance?.error ? (
                              <span title={distance.error} className="max-w-52 truncate text-xs text-red-600 dark:text-red-400">{distance.error}</span>
                            ) : (
                              <span className="text-xs text-[var(--muted-foreground)]">Distance non calculée</span>
                            )}
                            <Button variant="outline" size="sm" onClick={() => setMapEmployee(employee)} disabled={!employee.address}>
                              <MapPin className="h-4 w-4" />
                              Carte
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <Modal open={Boolean(mapEmployee)} onClose={() => setMapEmployee(null)} title={mapEmployee ? `Adresse de ${mapEmployee.fullName}` : "Adresse"} className="sm:h-[72vh] sm:w-[min(720px,80vw)] sm:max-w-[720px]">
        {mapEmployee ? (
          <div className="flex h-full min-h-[400px] flex-col gap-3">
            <p className="shrink-0 rounded-xl bg-brand-500/10 px-3 py-2 text-sm text-brand-800 dark:text-brand-200">
              Distance entre l&apos;adresse du salarié et le lieu de travail : {mapDistance?.distanceKm !== undefined ? (
                <strong>{mapDistance.distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km</strong>
              ) : (
                <span>à calculer depuis le tableau de bord.</span>
              )}
            </p>
            <iframe
              title={`Carte de ${mapEmployee.fullName}`}
              className="min-h-0 w-full flex-1 rounded-xl border-0"
              src={`https://maps.google.com/maps?q=${encodeURIComponent(mapEmployee.address)}&output=embed&t=k&z=19`}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
