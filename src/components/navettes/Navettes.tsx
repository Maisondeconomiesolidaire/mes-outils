import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarClock, Check, CircleCheck, Leaf, MapPin, PackageCheck, Pencil, Repeat2, Route, Truck, Undo2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { HOME_SITE, SITES, SITE_KEYS, transitOnRoute, type SiteKey } from "../../../convex/lib/navettesRoute";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { Input } from "../ui/Field";
import { FullSpinner } from "../ui/Spinner";
import { formatDateTime } from "../../lib/format";
import { PlaceSearch, type Destination } from "./PlaceSearch";

type Trip = FunctionReturnType<typeof api.navettes.myTrips>[number];
type Transit = FunctionReturnType<typeof api.navettes.openTransits>[number];

const SHORT: Record<SiteKey, string> = {
  recyclerie_pays_de_bray: "Solidarium",
  comptoir_c: "Comptoir C",
  esspace_150: "Esspace 150",
};
const TOWN: Record<SiteKey, string> = {
  recyclerie_pays_de_bray: "Lachapelle-aux-Pots",
  comptoir_c: "Beauvais",
  esspace_150: "Gournay-en-Bray",
};

function siteLabel(key: string | null, fallback: string) {
  return key && key in SHORT ? `${SHORT[key as SiteKey]} (${TOWN[key as SiteKey]})` : fallback;
}

function errorText(caught: unknown) {
  if (caught && typeof caught === "object" && "data" in caught && typeof (caught as { data: unknown }).data === "string") return (caught as { data: string }).data;
  return caught instanceof Error ? caught.message.replace(/^.*Uncaught (ConvexError: )?/, "").split("\n")[0] : "Une erreur est survenue.";
}

/** Calcul du trajet Solidarium → destination (aller-retour) et des sites sur la route. */
export function usePlanTrip() {
  const plan = useAction(api.navettes.planTrip);
  return plan;
}

/** Bandeau « Est-ce bien ce kilométrage ? » — Oui / Non, modifier. */
export function KmConfirm({
  routeKm,
  destinationLabel,
  busy,
  onConfirm,
}: {
  routeKm: number;
  destinationLabel: string;
  busy?: boolean;
  onConfirm: (km: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(routeKm));
  useEffect(() => setValue(String(routeKm)), [routeKm]);
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;
  return (
    <div className="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4">
      <p className="text-sm text-[var(--foreground)]">
        Trajet aller-retour : <strong>Solidarium → {destinationLabel} → Solidarium</strong>
      </p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-[var(--foreground)]">{routeKm.toLocaleString("fr-FR")} km</p>
      {!editing ? (
        <>
          <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">Est-ce bien ce kilométrage ?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => onConfirm(routeKm)}>
              <Check className="h-4 w-4" /> Oui
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Non, modifier
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" autoFocus />
          <span className="text-sm text-[var(--muted-foreground)]">km</span>
          <Button size="sm" disabled={busy || !valid} onClick={() => onConfirm(Math.round(parsed))}>
            Valider
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Annuler
          </Button>
        </div>
      )}
    </div>
  );
}

export function Navettes() {
  const trips = useQuery(api.navettes.myTrips, {});
  const transits = useQuery(api.navettes.openTransits, {});
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = searchParams.get("trip");
  const trip = trips?.find((t) => t._id === selectedId) ?? trips?.[0];

  if (trips === undefined || transits === undefined) return <FullSpinner />;

  return (
    <div className="space-y-5">
      <Intro />
      {trips.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="Aucun trajet à venir"
          description="Réservez un véhicule en indiquant votre destination : vous verrez ici les objets que vous pouvez emporter sur votre route."
          action={<Button onClick={() => navigate("/reservations?v=vehicles")}>Réserver un véhicule</Button>}
        />
      ) : (
        <>
          {trips.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {trips.map((t) => (
                <button
                  key={t._id}
                  type="button"
                  onClick={() => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.set("trip", t._id); return next; })}
                  className={`shrink-0 rounded-xl border px-3 py-2 text-left text-sm transition ${t._id === trip?._id ? "border-brand-500 bg-brand-500/10" : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)]"}`}
                >
                  <span className="block font-semibold text-[var(--foreground)]">{t.destination?.label ?? "Destination à préciser"}</span>
                  <span className="block text-xs text-[var(--muted-foreground)]">{formatDateTime(t.start)} · {t.vehicleName}</span>
                </button>
              ))}
            </div>
          ) : null}
          {trip ? <TripPanel key={trip._id} trip={trip} transits={transits} /> : null}
        </>
      )}
    </div>
  );
}

function Intro() {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-brand-600">
          <Repeat2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 space-y-2 text-sm text-[var(--muted-foreground)]">
          <h2 className="text-base font-bold text-[var(--foreground)]">Vous prenez un véhicule ? Faites voyager des objets avec vous</h2>
          <p>
            Si votre route passe par <strong className="text-[var(--foreground)]">Beauvais</strong> (Comptoir C)
            ou <strong className="text-[var(--foreground)]">Gournay-en-Bray</strong> (Esspace 150), vous pouvez y déposer ou y récupérer des objets qui attendent un transit.
          </p>
          <p className="flex items-start gap-2">
            <Leaf className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              Ça aide énormément la logistique : chaque objet emporté évite un trajet dédié, économise du carburant et des heures de conduite, et les clients
              récupèrent leurs achats plus vite. Choisissez les objets, puis cliquez sur « Prendre le produit ».
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function TripPanel({ trip, transits }: { trip: Trip; transits: Transit[] }) {
  const planTrip = usePlanTrip();
  const setTripDetails = useMutation(api.navettes.setTripDetails);
  const takeTransits = useMutation(api.navettes.takeTransits);
  const releaseTransit = useMutation(api.navettes.releaseTransit);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingDestination, setEditingDestination] = useState(false);

  const onRouteSites = useMemo(() => new Set<string>([HOME_SITE, ...(trip.sitesOnRoute ?? [])]), [trip.sitesOnRoute]);
  const planned = !trip.shuttle || trip.shuttle.status === "planifiee";
  const hasRoute = Boolean(trip.destination && trip.sitesOnRoute);
  const { onRoute, offRoute } = useMemo(() => {
    const on: Transit[] = [];
    const off: Transit[] = [];
    for (const t of transits) (hasRoute && transitOnRoute(t, trip.sitesOnRoute ?? []) ? on : off).push(t);
    return { onRoute: on, offRoute: off };
  }, [transits, trip.sitesOnRoute, hasRoute]);

  async function run(task: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      if (success) setNotice(success);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function chooseDestination(destination: Destination | null) {
    if (!destination) return;
    await run(async () => {
      const plan = await planTrip({ longitude: destination.longitude, latitude: destination.latitude });
      await setTripDetails({ reservationId: trip._id, destination, routeKm: plan.roundTripKm, sitesOnRoute: plan.sitesOnRoute });
      setEditingDestination(false);
    });
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function take() {
    const ids = [...selected] as Id<"mlRequests">[];
    await run(async () => {
      await takeTransits({ reservationId: trip._id, requestIds: ids });
      setSelected(new Set());
    }, ids.length > 1 ? `${ids.length} objets ajoutés à votre trajet. Merci !` : "Objet ajouté à votre trajet. Merci !");
  }

  const estimatedKm = trip.expectedKm ?? trip.routeKm;

  return (
    <section className="grid overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] lg:grid-cols-2">
      {/* ── Colonne gauche : la réservation et son trajet ───────────────── */}
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              <CalendarClock className="h-4 w-4" /> {formatDateTime(trip.start)} → {formatDateTime(trip.end)}
            </p>
            <h3 className="mt-1 text-lg font-bold text-[var(--foreground)]">
              {trip.vehicleName} · {trip.purpose}
            </h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              {trip.status === "approved" ? "Réservation approuvée" : "Réservation en attente d'approbation"}
            </p>
          </div>
          {trip.destination && !editingDestination && planned ? (
            <Button size="sm" variant="ghost" onClick={() => setEditingDestination(true)}>
              <Pencil className="h-4 w-4" /> Changer de destination
            </Button>
          ) : null}
        </div>

        {!trip.destination || editingDestination ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-[var(--foreground)]">Où allez-vous ?</p>
            <PlaceSearch value={null} onChange={(d) => void chooseDestination(d)} autoFocus />
            {busy ? <p className="text-xs text-[var(--muted-foreground)]">Calcul de l'itinéraire…</p> : null}
            {editingDestination ? (
              <Button size="sm" variant="ghost" onClick={() => setEditingDestination(false)}>Annuler</Button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--foreground)]">
                <Route className="h-4 w-4 text-brand-600" />
                <span>Solidarium</span>
                <ArrowRight className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4 text-brand-600" />{trip.destination.label}</span>
                <ArrowRight className="h-4 w-4 text-[var(--muted-foreground)]" />
                <span>Solidarium</span>
              </div>
              {trip.destination.address ? <p className="text-xs text-[var(--muted-foreground)]">{trip.destination.address}</p> : null}
              {estimatedKm !== null ? (
                <p className="text-xs text-[var(--muted-foreground)]">
                  ≈ {estimatedKm.toLocaleString("fr-FR")} km aller-retour{trip.kmConfirmed ? "" : " (estimé, à confirmer au retour du véhicule)"}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              {SITE_KEYS.map((key) => (
                <span
                  key={key}
                  className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${onRouteSites.has(key) ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-[var(--muted)] text-[var(--muted-foreground)]"}`}
                  title={SITES[key].address}
                >
                  {onRouteSites.has(key) ? <CircleCheck className="h-3.5 w-3.5" /> : null}
                  {SHORT[key]} · {TOWN[key]} {onRouteSites.has(key) ? "· sur votre route" : "· hors route"}
                </span>
              ))}
            </div>
          </>
        )}
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
        {notice ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</p> : null}
      </div>

      {/* ── Colonne droite : les objets à transporter (défilante) ───────── */}
      <div className="flex max-h-[70vh] min-h-[320px] flex-col border-t border-[var(--border)] lg:border-l lg:border-t-0">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-[var(--foreground)]">
            <Truck className="h-5 w-5 text-brand-600" /> Objets à transporter
          </h3>
          {hasRoute && planned ? (
            <Button size="sm" disabled={busy || selected.size === 0} onClick={() => void take()}>
              <PackageCheck className="h-4 w-4" /> Prendre le produit{selected.size > 1 ? ` (${selected.size})` : ""}
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
          {trip.transits.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Dans votre véhicule ({trip.transits.length})</p>
              <ul className="space-y-2">
                {trip.transits.map((t) => (
                  <TransitCard
                    key={t._id}
                    transit={t}
                    action={
                      t.status === "a_preparer" && planned ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => releaseTransit({ requestId: t._id }), "Objet reposé : il redevient disponible.")}>
                          <Undo2 className="h-4 w-4" /> Reposer
                        </Button>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700">{t.status === "en_transit" ? "En route" : t.status === "receptionnee" ? "Livré" : ""}</span>
                      )
                    }
                  />
                ))}
              </ul>
            </div>
          ) : null}

          {!hasRoute ? (
            <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
              Indiquez votre destination pour voir les objets sur votre route.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Sur votre route ({onRoute.length})</p>
              {!planned ? (
                <p className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-[var(--muted-foreground)]">Votre navette est partie : on ne peut plus y ajouter d'objets.</p>
              ) : onRoute.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted-foreground)]">
                  Aucun objet en attente sur votre route pour le moment. Merci d'avoir regardé !
                </p>
              ) : (
                <>
                  <p className="text-xs text-[var(--muted-foreground)]">À récupérer et à déposer sans détour, à l'aller ou au retour. Cochez ceux que vous pouvez emporter.</p>
                  <ul className="space-y-2">
                    {onRoute.map((t) => (
                      <TransitCard key={t._id} transit={t} selectable selected={selected.has(t._id)} onToggle={() => toggle(t._id)} />
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {offRoute.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                Hors de votre route ({offRoute.length})
              </summary>
              <ul className="mt-2 space-y-2 opacity-70">
                {offRoute.map((t) => (
                  <TransitCard key={t._id} transit={t} />
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TransitCard({
  transit,
  selectable,
  selected,
  onToggle,
  action,
}: {
  transit: Transit | Trip["transits"][number];
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  action?: React.ReactNode;
}) {
  const body = (
    <>
      {selectable ? (
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? "border-brand-500 bg-brand-500 text-white" : "border-[var(--border)]"}`}>
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : null}
      {transit.photoUrl ? (
        <img src={transit.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)]">
          <PackageCheck className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--foreground)]">{transit.title}</span>
        <span className="block text-xs text-[var(--muted-foreground)]">
          {transit.quantity.toLocaleString("fr-FR")} {transit.unit} · {transit.reference}
        </span>
        <span className="mt-1 block text-xs text-[var(--foreground)]">
          Récupérer : <strong>{siteLabel(transit.originKey, transit.origin)}</strong>
        </span>
        <span className="block text-xs text-[var(--foreground)]">
          Déposer : <strong>{siteLabel(transit.destinationKey, transit.destination)}</strong>
        </span>
        {transit.dueDate ? (
          <span className="mt-0.5 block text-xs font-semibold text-amber-700 dark:text-amber-300">
            À livrer avant le {new Date(`${transit.dueDate}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
          </span>
        ) : null}
      </span>
      {action ? <span className="shrink-0 self-center">{action}</span> : null}
    </>
  );
  const className = `flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-brand-500 bg-brand-500/10" : "border-[var(--border)] bg-[var(--card)]"}`;
  return (
    <li>
      {selectable ? (
        <button type="button" onClick={onToggle} className={`${className} hover:bg-[var(--accent)]`} aria-pressed={selected}>
          {body}
        </button>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}
