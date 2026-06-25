import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, CarFront, Check, DoorOpen, MapPin, Search, Users, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input, Textarea } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { defaultEnd, defaultStart, formatDateTime, parseLocalInput, toLocalInputValue } from "../lib/format";
import { canAccess } from "../lib/permissions";

type Room = {
  _id: Id<"rooms">;
  name: string;
  site?: "60" | "76";
  siteLabel?: string;
  buildingLabel?: string;
  capacity?: number;
  color?: string;
  services?: string[];
  photoUrl?: string;
  active: boolean;
};

type Vehicle = {
  _id: Id<"vehicles">;
  name: string;
  plate?: string;
  kind: string;
  brand?: string;
  model?: string;
  seats?: number;
  site?: "60" | "76";
  siteLabel?: string;
  photoUrl?: string | null;
};

type RoomReservation = {
  _id: Id<"roomReservations">;
  roomId: Id<"rooms">;
  userName: string;
  title: string;
  start: number;
  end: number;
};

type VehicleReservation = {
  _id: Id<"vehicleReservations">;
  vehicle?: Vehicle | null;
  userName: string;
  purpose: string;
  start: number;
  end: number;
  status: "pending" | "approved" | "rejected";
};

export function Reservations() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:reservations", "manage");
  const [tab, setTab] = useState<"rooms" | "vehicles">("rooms");
  const [query, setQuery] = useState("");
  const [rangeStart, setRangeStart] = useState(toLocalInputValue(defaultStart()));
  const [rangeEnd, setRangeEnd] = useState(toLocalInputValue(defaultEnd(0, 2)));
  const [selectedRoomId, setSelectedRoomId] = useState<Id<"rooms"> | "">("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<Id<"vehicles"> | "">("");
  const [roomTitle, setRoomTitle] = useState("");
  const [roomNotes, setRoomNotes] = useState("");
  const [vehiclePurpose, setVehiclePurpose] = useState("");

  const rooms = useQuery(api.reservations.listRooms) as Room[] | undefined;
  const roomReservations = useQuery(api.reservations.listRoomReservations, {
    start: parseLocalInput(rangeStart),
    end: parseLocalInput(rangeEnd),
  }) as RoomReservation[] | undefined;
  const vehicles = useQuery(api.reservations.listVehicles) as Vehicle[] | undefined;
  const vehicleReservations = useQuery(api.reservations.listVehicleReservations, {}) as
    | VehicleReservation[]
    | undefined;

  const bookRoom = useMutation(api.reservations.bookRoom);
  const cancelRoomReservation = useMutation(api.reservations.cancelRoomReservation);
  const requestVehicle = useMutation(api.reservations.requestVehicle);
  const decideVehicleReservation = useMutation(api.reservations.decideVehicleReservation);
  const cancelVehicleReservation = useMutation(api.reservations.cancelVehicleReservation);

  const activeRooms = (rooms ?? []).filter((room) => room.active);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredRooms = activeRooms.filter((room) =>
    [room.name, room.siteLabel, room.buildingLabel, ...(room.services ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
  const filteredVehicles = (vehicles ?? []).filter((vehicle) =>
    [vehicle.name, vehicle.brand, vehicle.model, vehicle.plate, vehicle.kind]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );

  const reservationsByRoom = useMemo(() => {
    const map = new Map<string, RoomReservation[]>();
    for (const reservation of roomReservations ?? []) {
      const key = String(reservation.roomId);
      map.set(key, [...(map.get(key) ?? []), reservation]);
    }
    return map;
  }, [roomReservations]);

  const selectedRoom = activeRooms.find((room) => room._id === selectedRoomId);
  const selectedVehicle = vehicles?.find((vehicle) => vehicle._id === selectedVehicleId);

  if (
    rooms === undefined ||
    roomReservations === undefined ||
    vehicles === undefined ||
    vehicleReservations === undefined
  ) {
    return <FullSpinner label="Chargement des reservations..." />;
  }

  async function submitRoomReservation() {
    if (!selectedRoomId || !roomTitle.trim()) return;
    await bookRoom({
      roomId: selectedRoomId,
      title: roomTitle,
      start: parseLocalInput(rangeStart),
      end: parseLocalInput(rangeEnd),
      notes: roomNotes || undefined,
    });
    setRoomTitle("");
    setRoomNotes("");
  }

  async function submitVehicleRequest() {
    if (!selectedVehicleId || !vehiclePurpose.trim()) return;
    await requestVehicle({
      vehicleId: selectedVehicleId,
      purpose: vehiclePurpose,
      start: parseLocalInput(rangeStart),
      end: parseLocalInput(rangeEnd),
    });
    setVehiclePurpose("");
  }

  return (
    <div className="space-y-7">
      <section className="space-y-5">
        <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)]">Réservations</h1>
        <div className="premium-panel grid gap-0 overflow-hidden rounded-[2rem] md:grid-cols-[minmax(220px,1fr)_210px_210px_84px]">
          <SearchBox value={query} onChange={setQuery} placeholder={tab === "rooms" ? "Rechercher une salle" : "Rechercher un véhicule"} />
          <DateBox label="Début" value={rangeStart} onChange={setRangeStart} />
          <DateBox label="Fin" value={rangeEnd} onChange={setRangeEnd} />
          <div className="flex items-center justify-center border-t border-[var(--border)] p-3 md:border-l md:border-t-0">
            <button className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 text-white shadow-[0_12px_26px_rgba(71,198,103,0.28)]">
              <Search className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

      <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--card)] p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setTab("rooms")}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            tab === "rooms" ? "bg-brand-500 text-white" : "text-[var(--foreground)]"
          }`}
        >
          Salles
        </button>
        <button
          type="button"
          onClick={() => setTab("vehicles")}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            tab === "vehicles" ? "bg-brand-500 text-white" : "text-[var(--foreground)]"
          }`}
        >
          Véhicules
        </button>
      </div>

      {tab === "rooms" ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredRooms.map((room) => {
              const items = (reservationsByRoom.get(String(room._id)) ?? []).sort((a, b) => a.start - b.start);
              return (
                <button
                  key={room._id}
                  type="button"
                  onClick={() => setSelectedRoomId(room._id)}
                  className={`group overflow-hidden rounded-[1.5rem] border bg-[var(--card)] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl ${
                    selectedRoomId === room._id ? "border-brand-500 ring-4 ring-brand-500/15" : "border-[var(--border)]"
                  }`}
                >
                  <AssetImage src={room.photoUrl} label={room.name} icon={<DoorOpen className="h-10 w-10" />} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold text-[var(--foreground)]">{room.name}</h2>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {room.buildingLabel ?? room.siteLabel ?? (room.site ? `Site ${room.site}` : "Site non renseigné")}
                        </p>
                      </div>
                      <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-800">
                        Libre
                      </span>
                    </div>
                    <div className="mt-4 flex items-center gap-4 text-sm text-[var(--muted-foreground)]">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        {room.capacity ?? "-"}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-4 w-4" />
                        {items.length} résa.
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </section>

          <aside className="premium-panel h-fit rounded-[1.5rem] p-5">
            {selectedRoom ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-[var(--muted-foreground)]">Salle sélectionnée</p>
                  <h2 className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{selectedRoom.name}</h2>
                </div>
                <Input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} placeholder="Objet de la réservation" />
                <Textarea value={roomNotes} onChange={(event) => setRoomNotes(event.target.value)} placeholder="Notes" />
                <Button className="w-full" size="lg" onClick={submitRoomReservation}>
                  Réserver
                </Button>
                <div className="space-y-2 border-t border-[var(--border)] pt-4">
                  {(reservationsByRoom.get(String(selectedRoom._id)) ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--muted-foreground)]">Aucune réservation sur ce créneau.</p>
                  ) : (
                    (reservationsByRoom.get(String(selectedRoom._id)) ?? []).map((reservation) => (
                      <div key={reservation._id} className="rounded-2xl bg-[var(--accent)] p-3">
                        <p className="font-medium text-[var(--foreground)]">{reservation.title}</p>
                        <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                          {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-2"
                          onClick={() => cancelRoomReservation({ reservationId: reservation._id })}
                        >
                          Annuler
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<DoorOpen className="h-8 w-8" />}
                title="Choisissez une salle"
                description="Cliquez sur une salle pour réserver le créneau."
              />
            )}
          </aside>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filteredVehicles.map((vehicle) => (
              <button
                key={vehicle._id}
                type="button"
                onClick={() => setSelectedVehicleId(vehicle._id)}
                className={`group overflow-hidden rounded-[1.5rem] border bg-[var(--card)] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl ${
                  selectedVehicleId === vehicle._id ? "border-brand-500 ring-4 ring-brand-500/15" : "border-[var(--border)]"
                }`}
              >
                <AssetImage src={vehicle.photoUrl ?? undefined} label={vehicle.name} icon={<CarFront className="h-10 w-10" />} />
                <div className="p-4">
                  <h2 className="text-lg font-semibold text-[var(--foreground)]">{vehicle.name}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {[vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(" · ") || vehicle.kind}
                  </p>
                  <div className="mt-4 flex items-center gap-4 text-sm text-[var(--muted-foreground)]">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      {vehicle.seats ?? "-"}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4" />
                      {vehicle.siteLabel ?? (vehicle.site ? `Site ${vehicle.site}` : "-")}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </section>

          <aside className="premium-panel h-fit rounded-[1.5rem] p-5">
            {selectedVehicle ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-[var(--muted-foreground)]">Véhicule sélectionné</p>
                  <h2 className="mt-1 text-2xl font-semibold text-[var(--foreground)]">{selectedVehicle.name}</h2>
                </div>
                <Textarea value={vehiclePurpose} onChange={(event) => setVehiclePurpose(event.target.value)} placeholder="Motif de la demande" />
                <Button className="w-full" size="lg" onClick={submitVehicleRequest}>
                  Demander
                </Button>
                <div className="space-y-2 border-t border-[var(--border)] pt-4">
                  {vehicleReservations.slice(0, 8).map((reservation) => (
                    <div key={reservation._id} className="rounded-2xl bg-[var(--accent)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-[var(--foreground)]">{reservation.vehicle?.name ?? "Véhicule"}</p>
                        <StatusBadge status={reservation.status} />
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                      </p>
                      <div className="mt-2 flex gap-2">
                        {canManage && reservation.status === "pending" ? (
                          <>
                            <Button size="sm" onClick={() => decideVehicleReservation({ reservationId: reservation._id, decision: "approved" })}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => decideVehicleReservation({ reservationId: reservation._id, decision: "rejected" })}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : null}
                        <Button variant="ghost" size="sm" onClick={() => cancelVehicleReservation({ reservationId: reservation._id })}>
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<CarFront className="h-8 w-8" />}
                title="Choisissez un véhicule"
                description="Cliquez sur un véhicule pour envoyer une demande."
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 md:border-b-0 md:border-r">
      <Search className="h-5 w-5 text-brand-500" />
      <span className="sr-only">{placeholder}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-base font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
      />
    </label>
  );
}

function DateBox({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="group block border-b border-[var(--border)] px-5 py-3 md:border-b-0 md:border-r">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">{label}</span>
      <input
        type="datetime-local"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full bg-transparent text-sm font-semibold text-[var(--foreground)] outline-none [color-scheme:light] group-hover:text-brand-600"
      />
    </label>
  );
}

function AssetImage({ src, label, icon }: { src?: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="asset-photo relative h-56 overflow-hidden">
      {src ? (
        <img src={src} alt={label} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
          {icon}
          <span className="text-sm font-semibold">Photo à ajouter</span>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: VehicleReservation["status"] }) {
  const styles = {
    approved: "bg-brand-100 text-brand-800",
    pending: "bg-amber-100 text-amber-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  const labels = {
    approved: "OK",
    pending: "Attente",
    rejected: "Refusé",
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}
