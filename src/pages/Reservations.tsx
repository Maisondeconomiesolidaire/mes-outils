import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { CalendarCheck, CarFront, DoorOpen, MapPin, Search, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Textarea } from "../components/ui/Field";
import { DateRangePicker, type DateRange } from "../components/ui/DateRangePicker";
import { Modal } from "../components/ui/Modal";
import { PersonSelect, type Person } from "../components/ui/PersonSelect";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDate, formatDateTime } from "../lib/format";
import { CalendarBoard, type CalendarEvent } from "../components/ui/CalendarBoard";

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
      {tab === "mine" ? <MyReservations /> : <BrowseAndBook tab={tab} />}
    </div>
  );
}

function BrowseAndBook({ tab }: { tab: "rooms" | "vehicles" }) {
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
  const [forUser, setForUser] = useState<Person | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openBooking(room: Room | null, vehicle: Vehicle | null) {
    setBookingRoom(room); setBookingVehicle(vehicle); setLabel(""); setNotes(""); setForUser(null); setError(null);
  }
  function closeBooking() { setBookingRoom(null); setBookingVehicle(null); }

  async function submitBooking() {
    if (!range.start || !range.end || !label.trim()) return;
    setSubmitting(true); setError(null);
    try {
      if (bookingRoom) await bookRoom({ roomId: bookingRoom._id, title: label, start: range.start, end: range.end, notes: notes || undefined, forClerkId: forUser?.clerkId, forName: forUser?.name });
      else if (bookingVehicle) await requestVehicle({ vehicleId: bookingVehicle._id, purpose: label, start: range.start, end: range.end, forClerkId: forUser?.clerkId, forName: forUser?.name });
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
      <div className="premium-panel rounded-2xl p-4">
        <Field label="Votre créneau">
          <DateRangePicker value={range} onChange={setRange} withTime />
        </Field>
      </div>

      <Agenda tab={tab} range={range} />

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
                  <Button className="mt-4 w-full" onClick={() => openBooking(room, null)}>Réserver</Button>
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
                <Button className="mt-4 w-full" onClick={() => openBooking(null, vehicle)}>Réserver</Button>
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
          <Field label={bookingRoom ? "Objet de la réservation" : "Motif de la demande"} required>
            {bookingRoom ? <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Réunion équipe..." /> : <Textarea value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Collecte, déménagement..." />}
          </Field>
          {bookingRoom ? <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field> : null}
          <Field label="Réserver pour"><PersonSelect people={directory} value={forUser?.clerkId ?? null} onChange={setForUser} /></Field>
          {bookingVehicle ? <p className="rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-[var(--muted-foreground)]">La réservation d'un véhicule est soumise à l'approbation d'un responsable.</p> : null}
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={closeBooking}>Annuler</Button>
            <Button size="lg" onClick={submitBooking} disabled={submitting || !label.trim()}>{submitting ? "Envoi..." : bookingRoom ? "Réserver" : "Demander"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Agenda({ tab, range }: { tab: "rooms" | "vehicles"; range: DateRange }) {
  const selected = new Date(range.start ?? Date.now());
  const start = new Date(selected);
  start.setHours(0, 0, 0, 0);
  const end = new Date(selected);
  end.setHours(23, 59, 59, 999);
  const dayStart = start.getTime();
  const dayEnd = end.getTime();
  const roomReservations = useQuery(api.reservations.listRoomReservations, tab === "rooms" ? { start: dayStart, end: dayEnd } : "skip");
  const rooms = useQuery(api.reservations.listRooms, tab === "rooms" ? {} : "skip") as Room[] | undefined;
  const vehicleBookings = useQuery(api.reservations.listVehicleBookings, tab === "vehicles" ? { start: dayStart, end: dayEnd } : "skip");

  const roomName = useMemo(() => new Map((rooms ?? []).map((r) => [String(r._id), r.name])), [rooms]);

  type Entry = { id: string; date: number; title: string; sub: string };
  let entries: Entry[] = [];
  if (tab === "rooms") {
    entries = (roomReservations ?? []).map((r) => ({ id: String(r._id), date: r.start, title: `${roomName.get(String(r.roomId)) ?? "Salle"} · ${r.title}`, sub: `${formatDateTime(r.start).slice(-5)}–${formatDateTime(r.end).slice(-5)} · ${r.userName}` }));
  } else {
    entries = (vehicleBookings ?? []).map((r) => ({ id: String(r._id), date: r.start, title: `${r.vehicleName} · ${r.userName}`, sub: `${formatDateTime(r.start).slice(-5)}–${formatDateTime(r.end).slice(-5)}${r.status === "pending" ? " · en attente" : ""}` }));
  }
  entries = entries.sort((a, b) => a.date - b.date);

  const calendarEvents: CalendarEvent[] = entries.map((entry) => ({
    id: entry.id,
    start: entry.date,
    title: entry.title,
    subtitle: entry.sub,
    tone: tab === "rooms" ? "brand" : entry.sub.includes("en attente") ? "amber" : "sky",
  }));

  return (
    <div className="space-y-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex items-center gap-2 px-1">
        <CalendarCheck className="h-4 w-4 text-brand-600" />
        <p className="text-sm font-semibold text-[var(--foreground)]">Déjà réservé · {formatDate(dayStart)}</p>
      </div>
      <CalendarBoard
        selected={dayStart}
        events={calendarEvents}
        onSelect={() => undefined}
        compact
      />
      {entries.length === 0 ? (
        <p className="px-1 pb-1 text-sm text-[var(--muted-foreground)]">Rien de réservé sur cette journée.</p>
      ) : null}
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
    confirmed: "bg-brand-100 text-brand-800",
    approved: "bg-brand-100 text-brand-800",
    pending: "bg-amber-100 text-amber-800",
    rejected: "bg-rose-100 text-rose-800",
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
