import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { CalendarCheck, CarFront, DoorOpen, MapPin, MessagesSquare, Search, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { usePermissionsAccess } from "../components/RequirePermission";
import { canAccess } from "../lib/permissions";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { DateRangePicker, type DateRange } from "../components/ui/DateRangePicker";
import { Modal } from "../components/ui/Modal";
import { PersonSelect, type Person } from "../components/ui/PersonSelect";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDateTime } from "../lib/format";
import { CalendarBoard, type CalendarEvent } from "../components/ui/CalendarBoard";
import { SectionTabs } from "../components/ui/SectionTabs";

const ROOM_USAGES = [
  "Réunion",
  "Atelier",
  "Animation",
  "Vente",
  "Déjeuner",
  "Evenement personnel",
  "Formation",
  "Travail",
  "Autre",
] as const;

type Room = { _id: Id<"rooms">; name: string; site?: "60" | "76"; siteLabel?: string; buildingLabel?: string; capacity?: number; photoUrl?: string | null };
type Vehicle = { _id: Id<"vehicles">; name: string; plate?: string; kind: string; brand?: string; model?: string; seats?: number; reservablePro?: boolean; reservablePersonal?: boolean; site?: "60" | "76"; siteLabel?: string; photoUrl?: string | null };

function defaultSlot(): DateRange {
  const s = new Date();
  s.setHours(9, 0, 0, 0);
  const e = new Date(s);
  e.setHours(10, 0, 0, 0);
  return { start: s.getTime(), end: e.getTime() };
}

export function Reservations() {
  const [searchParams] = useSearchParams();
  const tab = (["rooms", "vehicles", "mine"].includes(searchParams.get("v") ?? "") ? searchParams.get("v") : "rooms") as "rooms" | "vehicles" | "mine";

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Réservations"
        subtitle={tab === "rooms" ? "Salles disponibles sur votre créneau" : tab === "vehicles" ? "Véhicules disponibles sur votre créneau" : "Vos réservations"}
      />
      <SectionTabs />
      {tab === "mine" ? <MyReservations /> : <BrowseAndBook tab={tab} />}
    </div>
  );
}

function BrowseAndBook({ tab }: { tab: "rooms" | "vehicles" }) {
  const access = usePermissionsAccess();
  const canCreate = canAccess(access, "mesoutils:reservations", "create");
  const [range, setRange] = useState<DateRange>(defaultSlot);
  const [query, setQuery] = useState("");
  const [minSeats, setMinSeats] = useState("");
  const [usage, setUsage] = useState<"all" | "pro" | "personal">("all");
  const [minCapacity, setMinCapacity] = useState("");

  const hasRange = Boolean(range.start && range.end);
  const rooms = useQuery(api.reservations.availableRooms, hasRange && tab === "rooms" ? { start: range.start!, end: range.end! } : "skip") as Room[] | undefined;
  const vehicles = useQuery(api.reservations.availableVehicles, hasRange && tab === "vehicles" ? { start: range.start!, end: range.end! } : "skip") as Vehicle[] | undefined;

  const bookRoom = useMutation(api.reservations.bookRoom);
  const requestVehicle = useMutation(api.reservations.requestVehicle);
  const listDirectory = useAction(api.community.listStaffDirectory);
  const [directory, setDirectory] = useState<Person[]>([]);
  useEffect(() => {
    let cancelled = false;
    listDirectory().then((r) => { if (!cancelled) setDirectory(r as Person[]); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [listDirectory]);

  const [bookingRoom, setBookingRoom] = useState<Room | null>(null);
  const [bookingVehicle, setBookingVehicle] = useState<Vehicle | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [roomUsage, setRoomUsage] = useState<string>(ROOM_USAGES[0]);
  const [attendees, setAttendees] = useState("");
  const [vehicleUsage, setVehicleUsage] = useState<"pro" | "personal">("pro");
  const [expectedKm, setExpectedKm] = useState("");
  const [forUser, setForUser] = useState<Person | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openBooking(room: Room | null, vehicle: Vehicle | null) {
    setBookingRoom(room); setBookingVehicle(vehicle);
    setLabel(""); setNotes(""); setForUser(null); setError(null);
    setRoomUsage(ROOM_USAGES[0]); setAttendees("");
    setExpectedKm("");
    setVehicleUsage(vehicle && vehicle.reservablePro === false && vehicle.reservablePersonal === true ? "personal" : "pro");
  }
  function closeBooking() { setBookingRoom(null); setBookingVehicle(null); }

  const attendeesValue = Number(attendees) || 0;
  const overCapacity = Boolean(bookingRoom?.capacity && attendeesValue > bookingRoom.capacity);
  const canSubmit = Boolean(label.trim()) && (!bookingRoom || (attendeesValue >= 1 && !overCapacity));

  async function submitBooking() {
    if (!range.start || !range.end || !canSubmit) return;
    setSubmitting(true); setError(null);
    try {
      if (bookingRoom) await bookRoom({ roomId: bookingRoom._id, title: label, usageType: roomUsage, attendees: attendeesValue || undefined, start: range.start, end: range.end, notes: notes || undefined, forClerkId: forUser?.clerkId, forName: forUser?.name });
      else if (bookingVehicle) await requestVehicle({ vehicleId: bookingVehicle._id, purpose: label, usageType: vehicleUsage, expectedKm: expectedKm ? Number(expectedKm) : undefined, start: range.start, end: range.end, forClerkId: forUser?.clerkId, forName: forUser?.name });
      closeBooking();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Réservation impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const minCapacityValue = Number(minCapacity) || 0;
  const minSeatsValue = Number(minSeats) || 0;
  const filteredRooms = (rooms ?? []).filter((room) => {
    const matchesQuery = [room.name, room.siteLabel, room.buildingLabel].filter(Boolean).join(" ").toLowerCase().includes(needle);
    return matchesQuery && (minCapacityValue === 0 || (room.capacity ?? 0) >= minCapacityValue);
  });
  const filteredVehicles = (vehicles ?? []).filter((vehicle) => {
    const matchesQuery = [vehicle.name, vehicle.brand, vehicle.model, vehicle.plate, vehicle.kind].filter(Boolean).join(" ").toLowerCase().includes(needle);
    const matchesSeats = minSeatsValue === 0 || (vehicle.seats ?? 0) >= minSeatsValue;
    const matchesUsage = usage === "all" || (usage === "pro" && vehicle.reservablePro !== false) || (usage === "personal" && vehicle.reservablePersonal === true);
    return matchesQuery && matchesSeats && matchesUsage;
  });

  const loading = tab === "rooms" ? rooms === undefined : vehicles === undefined;
  const count = tab === "rooms" ? filteredRooms.length : filteredVehicles.length;

  return (
    <div className="space-y-5">
      {/* Calendrier / mini-agenda tout en haut. */}
      <Agenda tab={tab} range={range} />

      {/* Créneau + filtres regroupés juste en dessous. */}
      <div className="premium-panel space-y-4 rounded-2xl p-4">
        <Field label="Votre créneau">
          <DateRangePicker value={range} onChange={setRange} withTime />
        </Field>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex h-11 min-w-56 flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 sm:max-w-xs">
            <Search className="h-4 w-4 text-brand-600" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tab === "rooms" ? "Rechercher une salle" : "Rechercher un véhicule"} className="w-full bg-transparent text-sm font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]" />
          </label>
          {tab === "vehicles" ? (
            <>
              <FilterField label="Places min.">
                <select value={minSeats} onChange={(e) => setMinSeats(e.target.value)} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm font-medium text-[var(--foreground)] outline-none focus:border-brand-500">
                  <option value="">Toutes</option>{[2, 3, 5, 7, 9].map((n) => <option key={n} value={n}>{n}+</option>)}
                </select>
              </FilterField>
              <FilterField label="Usage">
                <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
                  {([{ key: "all", label: "Tous" }, { key: "pro", label: "Pro" }, { key: "personal", label: "Perso" }] as const).map((o) => (
                    <button key={o.key} type="button" onClick={() => setUsage(o.key)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${usage === o.key ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>{o.label}</button>
                  ))}
                </div>
              </FilterField>
            </>
          ) : (
            <FilterField label="Capacité min.">
              <select value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)} className="h-10 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 text-sm font-medium text-[var(--foreground)] outline-none focus:border-brand-500">
                <option value="">Toutes</option>{[2, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n}+ pers.</option>)}
              </select>
            </FilterField>
          )}
          <span className="ml-auto self-center text-sm font-medium text-[var(--muted-foreground)]">{count} disponible{count > 1 ? "s" : ""}</span>
        </div>
      </div>

      {!hasRange ? (
        <EmptyState icon={<CalendarCheck className="h-8 w-8" />} title="Choisissez un créneau" description="Sélectionnez une date et des horaires pour voir les disponibilités." />
      ) : loading ? (
        <FullSpinner label="Recherche des disponibilités..." />
      ) : tab === "rooms" ? (
        filteredRooms.length === 0 ? (
          <EmptyState icon={<DoorOpen className="h-8 w-8" />} title="Aucune salle disponible" description="Aucune salle libre sur ce créneau (ou ne correspond aux filtres)." />
        ) : (
          <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredRooms.map((room) => (
              <article key={room._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
                <AssetImage src={room.photoUrl} icon={<DoorOpen className="h-10 w-10" />} />
                <div className="p-4">
                  <h2 className="text-lg font-bold text-[var(--foreground)]">{room.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">{room.buildingLabel || room.siteLabel || (room.site ? `Site ${room.site}` : "Site —")}</p>
                  <div className="mt-3 flex items-center gap-1.5 text-sm text-[var(--muted-foreground)]"><Users className="h-4 w-4" />{room.capacity ? `${room.capacity} personnes` : "Capacité —"}</div>
                  {canCreate ? <Button className="mt-4 w-full" onClick={() => openBooking(room, null)}>Réserver</Button> : null}
                </div>
              </article>
            ))}
          </section>
        )
      ) : filteredVehicles.length === 0 ? (
        <EmptyState icon={<CarFront className="h-8 w-8" />} title="Aucun véhicule disponible" description="Aucun véhicule libre sur ce créneau (ou ne correspond aux filtres)." />
      ) : (
        <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredVehicles.map((vehicle) => (
            <article key={vehicle._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
              <AssetImage src={vehicle.photoUrl} icon={<CarFront className="h-10 w-10" />} />
              <div className="p-4">
                <h2 className="text-lg font-bold text-[var(--foreground)]">{vehicle.name}</h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">{[vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(" · ") || vehicle.kind}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted-foreground)]">
                  <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4" />{vehicle.seats ?? "—"} places</span>
                  <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{vehicle.siteLabel ?? (vehicle.site ? `Site ${vehicle.site}` : "—")}</span>
                </div>
                {canCreate ? <Button className="mt-4 w-full" onClick={() => openBooking(null, vehicle)}>Réserver</Button> : null}
              </div>
            </article>
          ))}
        </section>
      )}

      <Modal open={Boolean(bookingRoom || bookingVehicle)} onClose={closeBooking} title={bookingRoom ? `Réserver · ${bookingRoom.name}` : bookingVehicle ? `Réserver · ${bookingVehicle.name}` : "Réserver"}>
        <div className="grid gap-4">
          <div className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-[var(--foreground)]">
            {range.start && range.end ? `${formatDateTime(range.start)} → ${formatDateTime(range.end)}` : "Créneau non défini"}
          </div>
          <Field label={bookingRoom ? "Objet de la réservation" : "Motif de la réservation"} required>
            {bookingRoom ? <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Réunion équipe..." /> : <Textarea value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Collecte, déménagement..." />}
          </Field>

          {bookingRoom ? (
            <>
              <Field label="Type d'usage" required>
                <Select value={roomUsage} onChange={(e) => setRoomUsage(e.target.value)}>
                  {ROOM_USAGES.map((usage) => <option key={usage} value={usage}>{usage}</option>)}
                </Select>
              </Field>
              <Field
                label="Nombre de personnes attendues"
                required
                hint={bookingRoom.capacity ? `Capacité de la salle : ${bookingRoom.capacity} personnes.` : undefined}
                error={overCapacity ? `Maximum ${bookingRoom.capacity} personnes pour cette salle.` : undefined}
              >
                <Input
                  type="number"
                  min={1}
                  max={bookingRoom.capacity ?? undefined}
                  value={attendees}
                  onChange={(e) => setAttendees(e.target.value)}
                  placeholder="0"
                />
              </Field>
              <Field label="Commentaire (facultatif)"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </>
          ) : bookingVehicle ? (
            <>
              <Field label="Type d'usage" required>
                <div className="inline-flex w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
                  {([
                    { key: "pro" as const, label: "Professionnel", allowed: bookingVehicle.reservablePro !== false },
                    { key: "personal" as const, label: "Personnel", allowed: bookingVehicle.reservablePersonal === true },
                  ]).map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={!opt.allowed}
                      onClick={() => setVehicleUsage(opt.key)}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${vehicleUsage === opt.key ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Kilométrage estimé" hint="Nombre de kilomètres que vous pensez réaliser.">
                <div className="flex items-center gap-2">
                  <Input type="number" min={0} value={expectedKm} onChange={(e) => setExpectedKm(e.target.value)} placeholder="0" />
                  <span className="text-sm font-medium text-[var(--muted-foreground)]">km</span>
                </div>
              </Field>
            </>
          ) : null}

          <Field label="Réserver pour"><PersonSelect people={directory} value={forUser?.clerkId ?? null} onChange={setForUser} /></Field>
          {bookingVehicle ? <p className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-[var(--muted-foreground)]">La réservation d'un véhicule est soumise à l'approbation d'un responsable.</p> : null}
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={closeBooking}>Annuler</Button>
            <Button size="lg" onClick={submitBooking} disabled={submitting || !canSubmit}>{submitting ? "Envoi..." : bookingRoom ? "Réserver" : "Demander"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

type ReservationDetail = {
  id: string;
  date: number;
  endDate: number;
  assetName: string;
  reason: string;
  personName: string;
  personClerkId: string;
  pending?: boolean;
};

function Agenda({ tab, range }: { tab: "rooms" | "vehicles"; range: DateRange }) {
  const navigate = useNavigate();
  const { user } = useUser();
  const meId = user?.id ?? null;
  const [detailId, setDetailId] = useState<string | null>(null);

  const selected = new Date(range.start ?? Date.now());
  const start = new Date(selected);
  start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime();

  // Fenêtre large autour de la date sélectionnée : l'agenda affiche **toutes**
  // les réservations (de tous les utilisateurs) sur les jours du calendrier, et
  // pas seulement celles du jour choisi.
  const YEAR_MS = 365 * 86_400_000;
  const windowStart = dayStart - YEAR_MS;
  const windowEnd = dayStart + YEAR_MS;
  const roomReservations = useQuery(api.reservations.listRoomReservations, tab === "rooms" ? { start: windowStart, end: windowEnd } : "skip");
  const rooms = useQuery(api.reservations.listRooms, tab === "rooms" ? {} : "skip") as Room[] | undefined;
  const vehicleBookings = useQuery(api.reservations.listVehicleBookings, tab === "vehicles" ? { start: windowStart, end: windowEnd } : "skip");

  const roomName = useMemo(() => new Map((rooms ?? []).map((r) => [String(r._id), r.name])), [rooms]);

  const details: ReservationDetail[] = useMemo(() => {
    const list: ReservationDetail[] = tab === "rooms"
      ? (roomReservations ?? []).map((r) => ({
          id: String(r._id),
          date: r.start,
          endDate: r.end,
          assetName: roomName.get(String(r.roomId)) ?? "Salle",
          reason: r.title,
          personName: r.userName,
          personClerkId: r.bookedForClerkId ?? r.clerkId,
        }))
      : (vehicleBookings ?? []).map((r) => ({
          id: String(r._id),
          date: r.start,
          endDate: r.end,
          assetName: r.vehicleName,
          reason: r.purpose,
          personName: r.userName,
          personClerkId: r.clerkId,
          pending: r.status === "pending",
        }));
    return list.sort((a, b) => a.date - b.date);
  }, [tab, roomReservations, vehicleBookings, roomName]);

  const calendarEvents: CalendarEvent[] = details.map((entry) => ({
    id: entry.id,
    start: entry.date,
    title: tab === "rooms" ? `${entry.assetName} · ${entry.reason}` : `${entry.assetName} · ${entry.personName}`,
    subtitle: `${formatDateTime(entry.date).slice(-5)}–${formatDateTime(entry.endDate).slice(-5)} · ${entry.personName}`,
    tone: tab === "rooms" ? "brand" : entry.pending ? "amber" : "sky",
  }));

  const active = details.find((entry) => entry.id === detailId) ?? null;
  const isMine = active ? active.personClerkId === meId : false;

  return (
    <div className="space-y-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex items-center gap-2 px-1">
        <CalendarCheck className="h-4 w-4 text-brand-600" />
        <p className="text-sm font-semibold text-[var(--foreground)]">
          {tab === "rooms" ? "Réservations des salles" : "Réservations des véhicules"}
        </p>
      </div>
      <CalendarBoard
        selected={dayStart}
        events={calendarEvents}
        onSelect={() => undefined}
        onEventClick={(id) => setDetailId(id)}
        compact
      />
      {details.length === 0 ? (
        <p className="px-1 pb-1 text-sm text-[var(--muted-foreground)]">Aucune réservation enregistrée.</p>
      ) : (
        <p className="px-1 pb-1 text-xs text-[var(--muted-foreground)]">Toutes les réservations s'affichent sur le calendrier. Cliquez sur l'une d'elles pour voir les détails.</p>
      )}

      <Modal open={Boolean(active)} onClose={() => setDetailId(null)} title="Détail de la réservation">
        {active ? (
          <div className="grid gap-4">
            <div className="flex items-center gap-3 rounded-xl bg-[var(--accent)] px-3 py-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--card)] text-brand-600">
                {tab === "rooms" ? <DoorOpen className="h-5 w-5" /> : <CarFront className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-[var(--foreground)]">{active.assetName}</p>
                <p className="truncate text-sm text-[var(--muted-foreground)]">{active.reason}</p>
              </div>
            </div>
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted-foreground)]">Réservé par</dt>
                <dd className="font-semibold text-[var(--foreground)]">{active.personName}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted-foreground)]">Début</dt>
                <dd className="font-medium text-[var(--foreground)]">{formatDateTime(active.date)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-[var(--muted-foreground)]">Fin</dt>
                <dd className="font-medium text-[var(--foreground)]">{formatDateTime(active.endDate)}</dd>
              </div>
            </dl>
            {!isMine ? (
              <Button
                size="lg"
                onClick={() => navigate(`/messagerie?to=${encodeURIComponent(active.personClerkId)}&name=${encodeURIComponent(active.personName)}`)}
              >
                <MessagesSquare className="h-4 w-4" /> Envoyer un message à cette personne
              </Button>
            ) : (
              <p className="rounded-lg bg-[var(--accent)] px-3 py-2 text-center text-sm text-[var(--muted-foreground)]">C'est votre réservation.</p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

type MyReservation = {
  _id: string;
  kind: "room" | "vehicle";
  assetName: string;
  label: string;
  start: number;
  end: number;
  status: "confirmed" | "pending" | "approved" | "rejected";
};

function MyReservations() {
  const reservations = useQuery(api.reservations.listMyReservations) as MyReservation[] | undefined;
  const cancelRoom = useMutation(api.reservations.cancelRoomReservation);
  const cancelVehicle = useMutation(api.reservations.cancelVehicleReservation);
  const [filter, setFilter] = useState<"all" | "room" | "vehicle">("all");

  if (reservations === undefined) return <FullSpinner label="Chargement de vos réservations..." />;

  const filtered = reservations.filter((r) => filter === "all" || r.kind === filter);

  const statusLabel: Record<MyReservation["status"], string> = { confirmed: "Confirmée", pending: "En attente", approved: "Approuvée", rejected: "Refusée" };
  const statusStyle: Record<MyReservation["status"], string> = {
    confirmed: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200",
    approved: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200",
    pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    rejected: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  };

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
        {([{ key: "all", label: "Tous" }, { key: "room", label: "Salles" }, { key: "vehicle", label: "Véhicules" }] as const).map((o) => (
          <button key={o.key} type="button" onClick={() => setFilter(o.key)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${filter === o.key ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>{o.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<CalendarCheck className="h-8 w-8" />} title="Aucune réservation" description="Vos réservations passées et à venir s'afficheront ici." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] divide-y divide-[var(--border)]">
          {filtered.map((reservation) => {
            const past = reservation.end < Date.now();
            return (
              <div key={`${reservation.kind}-${reservation._id}`} className={`flex flex-wrap items-center gap-3 p-4 ${past ? "opacity-60" : ""}`}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-brand-600">
                  {reservation.kind === "room" ? <DoorOpen className="h-4 w-4" /> : <CarFront className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[var(--foreground)]">{reservation.assetName}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusStyle[reservation.status]}`}>{statusLabel[reservation.status]}</span>
                  </div>
                  <p className="truncate text-sm text-[var(--muted-foreground)]">{reservation.label}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}</p>
                </div>
                {!past && reservation.status !== "rejected" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      reservation.kind === "room"
                        ? cancelRoom({ reservationId: reservation._id as Id<"roomReservations"> })
                        : cancelVehicle({ reservationId: reservation._id as Id<"vehicleReservations"> })
                    }
                  >
                    Annuler
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
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

function AssetImage({ src, icon }: { src?: string | null; icon: React.ReactNode }) {
  return (
    <div className="relative aspect-video bg-[var(--muted)]">
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">{icon}</div>}
    </div>
  );
}
