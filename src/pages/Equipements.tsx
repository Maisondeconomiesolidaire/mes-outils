import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Boxes,
  CalendarCheck,
  CalendarDays,
  Clock,
  Info,
  Plus,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { SectionTabs } from "../components/ui/SectionTabs";
import { usePermissionsAccess } from "../components/RequirePermission";
import { canAccess } from "../lib/permissions";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Checkbox } from "../components/ui/Checkbox";
import { Modal } from "../components/ui/Modal";
import { PersonSelect, type Person } from "../components/ui/PersonSelect";
import { SinglePhotoUpload } from "../components/ui/SinglePhotoUpload";
import { FullSpinner } from "../components/ui/Spinner";
import { CalendarBoard, type CalendarEvent } from "../components/ui/CalendarBoard";
import { formatDate, formatDateTime } from "../lib/format";
import { confirmPermanentDelete } from "../lib/confirm";

const FULL_DAY_START_TIME = "08:00";
const FULL_DAY_END_TIME = "18:00";

/** Heures proposées : journée entière + pas de 30 min, 06:00 → 22:00. */
const TIME_OPTIONS = [
  FULL_DAY_START_TIME,
  ...Array.from({ length: 33 }, (_, index) => {
    const minutes = 6 * 60 + index * 30;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }),
  FULL_DAY_END_TIME,
];

type Occupied = { userName: string; start: number; end: number } | null;

type Equipment = {
  _id: Id<"equipments">;
  name: string;
  category?: string;
  reference?: string;
  site?: "60" | "76";
  photo?: Id<"_storage">;
  photoUrl?: string | null;
  buildingLabel?: string;
  notes?: string;
  active: boolean;
  occupiedBy?: Occupied;
};

type EquipmentReservation = {
  _id: Id<"equipmentReservations">;
  equipmentId: Id<"equipments">;
  title: string;
  userName: string;
  bookedByName?: string;
  start: number;
  end: number;
  status?: "confirmed" | "cancelled";
  notes?: string;
};

type MyReservation = {
  _id: string;
  assetName: string;
  photoUrl?: string | null;
  label: string;
  start: number;
  end: number;
  status: "confirmed" | "cancelled";
};

type DaySelection = { start: number; end: number };

function startOfDayMs(input: number | Date): number {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function withTime(dayMs: number, time: string): number {
  const [h, m] = time.split(":").map(Number);
  const date = new Date(dayMs);
  date.setHours(h, m, 0, 0);
  return date.getTime();
}

export function Equipements() {
  const [searchParams] = useSearchParams();
  const tab = (["book", "planning", "mine", "manage"].includes(searchParams.get("v") ?? "")
    ? searchParams.get("v")
    : "book") as "book" | "planning" | "mine" | "manage";

  return (
    <div className="space-y-6">
      <SectionHeader title="Équipements" />
      <SectionTabs />
      {tab === "book" ? <BookEquipment /> : null}
      {tab === "planning" ? <EquipmentPlanning /> : null}
      {tab === "mine" ? <MyEquipmentReservations /> : null}
      {tab === "manage" ? <ManageEquipments /> : null}
    </div>
  );
}

// ─── Réserver ────────────────────────────────────────────────────────────────

function BookEquipment() {
  const access = usePermissionsAccess();
  const canCreate = canAccess(access, "mesoutils:equipements", "create");

  const [days, setDays] = useState<DaySelection>(() => {
    const today = startOfDayMs(Date.now());
    return { start: today, end: today };
  });
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [fullDay, setFullDay] = useState(false);

  useEffect(() => {
    if (!fullDay) return;
    setStartTime(FULL_DAY_START_TIME);
    setEndTime(FULL_DAY_END_TIME);
  }, [fullDay]);

  function handleDayClick(day: Date) {
    const clicked = startOfDayMs(day);
    setDays((current) => {
      if (current.start !== current.end || clicked <= current.start) {
        return { start: clicked, end: clicked };
      }
      return { start: current.start, end: clicked };
    });
  }
  function handleDayDoubleClick(day: Date) {
    const clicked = startOfDayMs(day);
    setDays({ start: clicked, end: clicked });
  }

  const range = useMemo(() => {
    return { start: withTime(days.start, startTime), end: withTime(days.end, endTime) };
  }, [days, startTime, endTime]);
  const rangeValid = range.start < range.end;

  const durationDays = Math.round((days.end - days.start) / 86_400_000) + 1;
  const summary =
    days.start === days.end
      ? format(new Date(days.start), "EEEE d MMMM yyyy", { locale: fr })
      : `${format(new Date(days.start), "EEE d MMM", { locale: fr })} → ${format(new Date(days.end), "EEE d MMM yyyy", { locale: fr })}`;

  const [query, setQuery] = useState("");
  const equipments = useQuery(
    api.equipements.listEquipmentsForSlot,
    rangeValid ? { start: range.start, end: range.end } : "skip",
  ) as Equipment[] | undefined;

  const YEAR_MS = 365 * 86_400_000;
  const reservations = useQuery(api.equipements.listEquipmentReservations, {
    start: days.start - YEAR_MS,
    end: days.start + YEAR_MS,
  }) as EquipmentReservation[] | undefined;
  const allEquipments = useQuery(api.equipements.listEquipments) as Equipment[] | undefined;
  const equipmentName = useMemo(
    () => new Map((allEquipments ?? []).map((e) => [String(e._id), e.name])),
    [allEquipments],
  );

  const bookEquipment = useMutation(api.equipements.bookEquipment);
  const listDirectory = useAction(api.equipements.listEquipmentDirectory);
  const [directory, setDirectory] = useState<Person[]>([]);
  useEffect(() => {
    let cancelled = false;
    listDirectory({})
      .then((result) => {
        if (!cancelled) setDirectory(result as Person[]);
      })
      .catch(() => {
        if (!cancelled) setDirectory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [listDirectory]);

  const [booking, setBooking] = useState<Equipment | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [forUser, setForUser] = useState<Person | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openBooking(equipment: Equipment) {
    setBooking(equipment);
    setLabel("");
    setNotes("");
    setForUser(null);
    setError(null);
  }
  function closeBooking() {
    setBooking(null);
  }

  const canSubmit = rangeValid && Boolean(label.trim());

  async function submitBooking() {
    if (!booking || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await bookEquipment({
        equipmentId: booking._id,
        title: label,
        start: range.start,
        end: range.end,
        notes: notes || undefined,
        forClerkId: forUser?.clerkId,
        forName: forUser?.name,
      });
      closeBooking();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Réservation impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const filtered = (equipments ?? []).filter((equipment) =>
    [equipment.name, equipment.category, equipment.reference, equipment.buildingLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
  const freeCount = filtered.filter((equipment) => !equipment.occupiedBy).length;

  const calendarEvents: CalendarEvent[] = (reservations ?? []).map((reservation) => ({
    id: String(reservation._id),
    start: reservation.start,
    end: reservation.end,
    title: `${equipmentName.get(String(reservation.equipmentId)) ?? "Équipement"} · ${reservation.title}`,
    subtitle: reservation.userName,
    tone: "brand",
  }));

  return (
    <div className="space-y-5">
      <div className="space-y-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
        <div className="space-y-1 px-1">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarCheck className="h-4 w-4 text-brand-600" />
            <p className="text-sm font-semibold text-[var(--foreground)]">Réservations des équipements</p>
          </div>
          <p className="text-sm font-medium leading-6 text-[var(--foreground)] sm:text-base">
            Double cliquez sur un jour du calendrier (début), puis un seul clic sur le second (fin). Double clic sur un jour = ce jour uniquement.
          </p>
        </div>
        <CalendarBoard
          rangeStart={days.start}
          rangeEnd={days.end}
          events={calendarEvents}
          onSelect={handleDayClick}
          onDoubleSelect={handleDayDoubleClick}
          disabledBefore={Date.now()}
          compact
        />
        <div className="space-y-4 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--selected)] px-3.5 py-1.5 text-sm font-semibold capitalize text-[var(--selected-foreground)]">
              <CalendarCheck className="h-4 w-4" />
              {summary}
            </span>
            <span className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-sm font-semibold text-[var(--foreground)]">
              {durationDays} jour{durationDays > 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <FilterField label="Heure de début">
              <TimeSelect value={startTime} onChange={setStartTime} disabled={fullDay} />
            </FilterField>
            <FilterField label="Heure de fin">
              <TimeSelect value={endTime} onChange={setEndTime} disabled={fullDay} />
            </FilterField>
            <div className="pb-2">
              <Checkbox checked={fullDay} onChange={setFullDay} label="Journée entière" />
            </div>
            {!rangeValid ? (
              <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                L'heure de fin doit être après l'heure de début.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
            <label className="flex h-11 min-w-56 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 sm:max-w-xs">
              <Search className="h-4 w-4 text-brand-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un équipement"
                className="w-full bg-transparent text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </label>
            <span className="ml-auto self-center text-sm font-medium text-[var(--muted-foreground)]">
              {freeCount} disponible{freeCount > 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>

      {!rangeValid ? (
        <EmptyState icon={<Clock className="h-8 w-8" />} title="Créneau invalide" description="Corrigez les heures de début et de fin pour voir les disponibilités." />
      ) : equipments === undefined ? (
        <FullSpinner label="Recherche des disponibilités..." />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Boxes className="h-8 w-8" />} title="Aucun équipement" description="Aucun équipement ne correspond à votre recherche." />
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((equipment) => {
            const occupied = equipment.occupiedBy ?? null;
            return (
              <article key={equipment._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
                <EquipmentImage src={equipment.photoUrl} occupied={occupied} />
                <div className="p-4">
                  <h2 className="text-lg font-bold text-[var(--foreground)]">{equipment.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {[equipment.category, equipment.reference].filter(Boolean).join(" · ") ||
                      equipment.buildingLabel ||
                      (equipment.site ? `Site ${equipment.site}` : "—")}
                  </p>
                  {canCreate && !occupied ? (
                    <Button className="mt-4 w-full" onClick={() => openBooking(equipment)}>
                      Réserver
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </section>
      )}

      <Modal open={Boolean(booking)} onClose={closeBooking} title={booking ? `Réserver · ${booking.name}` : "Réserver"}>
        <div className="grid gap-4">
          <div className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-[var(--foreground)]">
            {rangeValid ? `${formatDateTime(range.start)} → ${formatDateTime(range.end)}` : "Créneau non défini"}
          </div>
          <Field label="Objet de la réservation" required>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Chantier, animation, prêt..." />
          </Field>
          <Field label="Commentaire (facultatif)">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label="Réserver pour">
            <PersonSelect people={directory} value={forUser} onChange={setForUser} />
          </Field>
          <p className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
            Le créneau étant libre, la réservation est confirmée immédiatement.
          </p>
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={closeBooking}>Annuler</Button>
            <Button size="lg" onClick={submitBooking} disabled={submitting || !canSubmit}>
              {submitting ? "Envoi..." : "Réserver"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Planning ────────────────────────────────────────────────────────────────

function EquipmentPlanning() {
  const access = usePermissionsAccess();
  const canDeleteForever = access?.email?.trim().toLowerCase() === "lahmerselim@gmail.com";
  const today = startOfDayMs(Date.now());
  const YEAR_MS = 365 * 86_400_000;
  const reservations = useQuery(api.equipements.listEquipmentReservations, {
    start: today - YEAR_MS,
    end: today + YEAR_MS,
  }) as EquipmentReservation[] | undefined;
  const equipments = useQuery(api.equipements.listEquipments) as Equipment[] | undefined;
  const cancel = useMutation(api.equipements.cancelEquipmentReservation);
  const equipmentById = useMemo(
    () => new Map((equipments ?? []).map((e) => [String(e._id), e])),
    [equipments],
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EquipmentReservation | null>(null);

  if (reservations === undefined) return <FullSpinner label="Chargement du planning..." />;

  const needle = query.trim().toLowerCase();
  const upcoming = [...reservations]
    .filter((reservation) => {
      if (!needle) return true;
      const equipment = equipmentById.get(String(reservation.equipmentId));
      return [reservation.title, reservation.userName, reservation.bookedByName, reservation.notes, equipment?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    })
    .sort((a, b) => a.start - b.start);

  async function cancelWithConfirmation(reservationId: Id<"equipmentReservations">) {
    const message = canDeleteForever
      ? "Êtes-vous sûr(e) de vouloir supprimer définitivement cette réservation d'équipement ?"
      : "Annuler cette réservation d'équipement ? Elle restera conservée en base.";
    if (!(await confirmPermanentDelete(message))) return;
    void cancel({ reservationId });
  }

  if (upcoming.length === 0) {
    return (
      <div className="space-y-5">
        <SearchBar query={query} onChange={setQuery} />
        <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Aucune réservation" description="Le planning des équipements s'affichera ici." />
      </div>
    );
  }

  const byDay = new Map<string, EquipmentReservation[]>();
  for (const reservation of upcoming) {
    const key = formatDate(reservation.start);
    byDay.set(key, [...(byDay.get(key) ?? []), reservation]);
  }

  return (
    <div className="space-y-5">
      <SearchBar query={query} onChange={setQuery} />
      {Array.from(byDay.entries()).map(([day, items]) => (
        <section key={day} className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--border)] bg-[var(--accent)] px-5 py-2.5">
            <p className="text-sm font-bold capitalize text-[var(--foreground)]">{day}</p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {items.map((reservation) => {
              const equipment = equipmentById.get(String(reservation.equipmentId));
              return (
                <div key={reservation._id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <span className="h-9 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {reservation.title} · {equipment?.name ?? "Équipement"}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setSelected(reservation)}>
                    <Info className="h-4 w-4" />Détails
                  </Button>
                  <button
                    type="button"
                    onClick={() => cancelWithConfirmation(reservation._id)}
                    className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600"
                    title={canDeleteForever ? "Supprimer" : "Annuler la réservation"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Détail de la réservation">
        {selected ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 rounded-xl bg-[var(--accent)] px-3 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--card)] text-brand-600">
                <Boxes className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--foreground)]">
                  {equipmentById.get(String(selected.equipmentId))?.name ?? "Équipement"}
                </p>
                <p className="truncate text-sm text-[var(--muted-foreground)]">{selected.title}</p>
              </div>
            </div>
            <dl className="grid gap-3 text-sm">
              <DetailRow label="Réservé pour" value={selected.userName} />
              <DetailRow label="Réservé par" value={selected.bookedByName ?? selected.userName} />
              <DetailRow label="Début" value={formatDateTime(selected.start)} />
              <DetailRow label="Fin" value={formatDateTime(selected.end)} />
            </dl>
            {selected.notes ? (
              <div className="rounded-xl border border-[var(--border)] p-3">
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Note</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{selected.notes}</p>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <Button variant="ghost" onClick={() => setSelected(null)}>Fermer</Button>
              <Button
                variant="outline"
                onClick={() => {
                  cancelWithConfirmation(selected._id);
                  setSelected(null);
                }}
              >
                <Trash2 className="h-4 w-4" />
                {canDeleteForever ? "Supprimer" : "Annuler la réservation"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

// ─── Mes réservations ────────────────────────────────────────────────────────

function MyEquipmentReservations() {
  const access = usePermissionsAccess();
  const canDeleteForever = access?.email?.trim().toLowerCase() === "lahmerselim@gmail.com";
  const reservations = useQuery(api.equipements.listMyEquipmentReservations) as MyReservation[] | undefined;
  const cancel = useMutation(api.equipements.cancelEquipmentReservation);

  if (reservations === undefined) return <FullSpinner label="Chargement de vos réservations..." />;

  const statusLabel: Record<MyReservation["status"], string> = { confirmed: "Confirmée", cancelled: "Annulée" };
  const statusStyle: Record<MyReservation["status"], string> = {
    confirmed: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200",
    cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200",
  };

  async function cancelWithConfirmation(reservation: MyReservation) {
    const message = canDeleteForever
      ? "Êtes-vous sûr(e) de vouloir supprimer définitivement cette réservation d'équipement ?"
      : "Annuler cette réservation d'équipement ? Elle restera visible dans l'historique.";
    if (!(await confirmPermanentDelete(message))) return;
    void cancel({ reservationId: reservation._id as Id<"equipmentReservations"> });
  }

  if (reservations.length === 0) {
    return <EmptyState icon={<CalendarCheck className="h-8 w-8" />} title="Aucune réservation" description="Vos réservations d'équipements s'afficheront ici." />;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
      {reservations.map((reservation) => {
        const past = reservation.end < Date.now();
        return (
          <div key={reservation._id} className="flex flex-wrap items-center gap-3 p-4">
            <span className={`h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-[var(--accent)] ${past ? "opacity-60" : ""}`}>
              {reservation.photoUrl ? (
                <img src={reservation.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-brand-600">
                  <Boxes className="h-4 w-4" />
                </span>
              )}
            </span>
            <div className={`min-w-0 flex-1 ${past ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-[var(--foreground)]">{reservation.assetName}</p>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle[reservation.status]}`}>
                  {statusLabel[reservation.status]}
                </span>
              </div>
              <p className="truncate text-sm text-[var(--muted-foreground)]">{reservation.label}</p>
              <p className="text-xs text-[var(--muted-foreground)]">{formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}</p>
            </div>
            {!past && reservation.status !== "cancelled" ? (
              <Button variant="ghost" size="sm" onClick={() => cancelWithConfirmation(reservation)}>
                {canDeleteForever ? "Supprimer" : "Annuler"}
              </Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Gestion des équipements (droit « Gestion ») ─────────────────────────────

const emptyForm = {
  name: "",
  category: "",
  reference: "",
  site: "" as "" | "60" | "76",
  photo: null as Id<"_storage"> | null,
  photoUrl: "",
  buildingLabel: "",
  notes: "",
  active: true,
};
type FormState = typeof emptyForm;

function ManageEquipments() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:equipements", "manage");
  const equipments = useQuery(api.equipements.listEquipments) as Equipment[] | undefined;
  const createEquipment = useMutation(api.equipements.createEquipment);
  const updateEquipment = useMutation(api.equipements.updateEquipment);
  const deleteEquipment = useMutation(api.equipements.deleteEquipment);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"equipments"> | "">("");
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const editing = equipments?.find((equipment) => equipment._id === editingId);

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      setForm({
        name: editing.name,
        category: editing.category ?? "",
        reference: editing.reference ?? "",
        site: editing.site ?? "",
        photo: editing.photo ?? null,
        photoUrl: editing.photoUrl ?? "",
        buildingLabel: editing.buildingLabel ?? "",
        notes: editing.notes ?? "",
        active: editing.active,
      });
    } else {
      setForm(emptyForm);
    }
  }, [modalOpen, editing]);

  if (equipments === undefined) return <FullSpinner label="Chargement des équipements..." />;

  function payload(next: FormState) {
    return {
      name: next.name,
      category: next.category || undefined,
      reference: next.reference || undefined,
      site: next.site || undefined,
      photo: next.photo ?? undefined,
      photoUrl: next.photoUrl || undefined,
      buildingLabel: next.buildingLabel || undefined,
      notes: next.notes || undefined,
      active: next.active,
    };
  }

  async function persist(next: FormState, closeAfterSave = false) {
    if (!next.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateEquipment({ equipmentId: editingId, ...payload(next) });
      } else {
        await createEquipment(payload(next));
      }
      if (closeAfterSave) setModalOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function updateForm(patch: Partial<FormState>) {
    const next = { ...form, ...patch };
    setForm(next);
    if (editingId && canManage) void persist(next);
  }

  async function removeEquipment() {
    if (!editingId) return;
    if (!(await confirmPermanentDelete("Supprimer définitivement cet équipement et ses réservations ?"))) return;
    await deleteEquipment({ equipmentId: editingId });
    setModalOpen(false);
  }

  return (
    <div className="space-y-6">
      {canManage ? (
        <div className="flex justify-end">
          <Button size="lg" onClick={() => { setEditingId(""); setModalOpen(true); }}>
            <Plus className="h-5 w-5" />
            Nouvel équipement
          </Button>
        </div>
      ) : null}

      {equipments.length === 0 ? (
        <EmptyState icon={<Boxes className="h-8 w-8" />} title="Aucun équipement" description="Ajoutez votre premier équipement réservable." />
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {equipments.map((equipment) => (
            <article
              key={equipment._id}
              onClick={canManage ? () => { setEditingId(equipment._id); setModalOpen(true); } : undefined}
              className={`group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:shadow-md ${canManage ? "cursor-pointer" : ""}`}
            >
              <div className="relative aspect-video overflow-hidden bg-[var(--muted)]">
                {equipment.photoUrl ? (
                  <img src={equipment.photoUrl} alt={equipment.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                ) : (
                  <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
                    <Boxes className="h-10 w-10" />
                  </div>
                )}
                <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${equipment.active ? "bg-brand-500 text-white" : "bg-zinc-500 text-white"}`}>
                  {equipment.active ? "Actif" : "Inactif"}
                </span>
              </div>
              <div className="p-4">
                <h2 className="text-lg font-bold text-[var(--foreground)]">{equipment.name}</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {[equipment.category, equipment.reference].filter(Boolean).join(" · ") ||
                    equipment.buildingLabel ||
                    (equipment.site ? `Site ${equipment.site}` : "—")}
                </p>
              </div>
            </article>
          ))}
        </section>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Modifier l'équipement" : "Nouvel équipement"}>
        <div className="grid gap-4">
          <SinglePhotoUpload className="mx-auto w-full max-w-3xl" value={form.photo} previewUrl={form.photoUrl || null} onChange={(id) => updateForm({ photo: id })} />
          <Field label="Nom" required>
            <Input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Catégorie">
              <Input value={form.category} onChange={(event) => updateForm({ category: event.target.value })} placeholder="Outillage, mobilier..." />
            </Field>
            <Field label="Référence">
              <Input value={form.reference} onChange={(event) => updateForm({ reference: event.target.value })} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Site">
              <Select value={form.site} onChange={(event) => updateForm({ site: event.target.value as "" | "60" | "76" })}>
                <option value="">Non renseigné</option>
                <option value="60">Site 60</option>
                <option value="76">Site 76</option>
              </Select>
            </Field>
            <Field label="Bâtiment / zone">
              <Input value={form.buildingLabel} onChange={(event) => updateForm({ buildingLabel: event.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} />
          </Field>
          <Field label="Statut">
            <Select value={form.active ? "active" : "inactive"} onChange={(event) => updateForm({ active: event.target.value === "active" })}>
              <option value="active">Actif</option>
              <option value="inactive">Inactif</option>
            </Select>
          </Field>
          {editingId ? (
            <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
              <Button variant="outline" onClick={removeEquipment}>
                <Trash2 className="h-4 w-4" />Supprimer
              </Button>
              <p className="text-right text-xs font-medium text-[var(--muted-foreground)]">
                {saving ? "Enregistrement..." : "Modifications enregistrées automatiquement"}
              </p>
            </div>
          ) : (
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Annuler</Button>
              <Button size="lg" onClick={() => persist(form, true)} disabled={saving || !form.name.trim()}>
                <Save className="h-4 w-4" />
                {saving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ─── Petits composants partagés ──────────────────────────────────────────────

function SearchBar({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  return (
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
      <Input value={query} onChange={(event) => onChange(event.target.value)} placeholder="Rechercher par équipement, nom, objet..." className="pl-9" />
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-[var(--muted-foreground)]">{label}</dt>
      <dd className="font-semibold text-[var(--foreground)]">{value}</dd>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</span>
      {children}
    </label>
  );
}

function TimeSelect({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className={`flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 ${disabled ? "opacity-50" : ""}`}>
      <Clock className="h-4 w-4 text-brand-600" />
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="bg-transparent text-sm font-semibold text-[var(--foreground)] outline-none">
        {TIME_OPTIONS.map((time) => <option key={time} value={time}>{time}</option>)}
      </select>
    </div>
  );
}

function EquipmentImage({ src, occupied }: { src?: string | null; occupied?: Occupied }) {
  const blockedText = occupied
    ? `Réservé jusqu'au ${format(new Date(occupied.end), "dd/MM/yy HH:mm", { locale: fr })} par ${occupied.userName}`
    : null;
  return (
    <div className="relative aspect-video bg-[var(--muted)]">
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${blockedText ? "opacity-35" : ""}`} />
      ) : (
        <div className={`flex h-full items-center justify-center text-[var(--muted-foreground)] ${blockedText ? "opacity-35" : ""}`}>
          <Boxes className="h-10 w-10" />
        </div>
      )}
      {blockedText ? (
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <span className="rounded-full bg-black/70 px-3.5 py-1.5 text-center text-sm font-semibold text-white shadow-lg">{blockedText}</span>
        </div>
      ) : null}
    </div>
  );
}
