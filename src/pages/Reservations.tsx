import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CalendarCheck,
  CarFront,
  Check,
  Clock3,
  DoorOpen,
  MapPin,
  Users,
  X,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import {
  defaultEnd,
  defaultStart,
  formatDateTime,
  parseLocalInput,
  toLocalInputValue,
} from "../lib/format";
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
  notes?: string;
};

type VehicleReservation = {
  _id: Id<"vehicleReservations">;
  vehicle?: Vehicle | null;
  vehiclePhotoUrl?: string | null;
  userName: string;
  purpose: string;
  start: number;
  end: number;
  status: "pending" | "approved" | "rejected";
  decisionNote?: string;
};

export function Reservations() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:reservations", "manage");

  const [tab, setTab] = useState<"rooms" | "vehicles">("rooms");
  const [rangeStart, setRangeStart] = useState(toLocalInputValue(defaultStart()));
  const [rangeEnd, setRangeEnd] = useState(toLocalInputValue(defaultEnd(0, 2)));
  const [selectedRoomId, setSelectedRoomId] = useState<Id<"rooms"> | "">("");
  const [roomTitle, setRoomTitle] = useState("");
  const [roomNotes, setRoomNotes] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<Id<"vehicles"> | "">("");
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

  const activeRooms = useMemo(
    () => (rooms ?? []).filter((room) => room.active),
    [rooms],
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
  const pendingCount = vehicleReservations?.filter((item) => item.status === "pending").length ?? 0;

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
    <div className="space-y-8">
      <section className="premium-shell overflow-hidden rounded-[2rem] bg-[#111812] text-white">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:p-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-300">
              Reservations
            </p>
            <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              Reservez les ressources internes avec le niveau d'exigence d'une vraie plateforme.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/68 sm:text-base">
              Salles confirmees instantanement, vehicules soumis a validation, et disponibilites
              partagees avec la recyclerie pour eviter les conflits operationnels.
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-white/72">Debut</label>
                <Input
                  type="datetime-local"
                  value={rangeStart}
                  onChange={(event) => setRangeStart(event.target.value)}
                  className="border-white/10 bg-white text-[#17231a]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-white/72">Fin</label>
                <Input
                  type="datetime-local"
                  value={rangeEnd}
                  onChange={(event) => setRangeEnd(event.target.value)}
                  className="border-white/10 bg-white text-[#17231a]"
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              <Metric value={activeRooms.length} label="Salles" />
              <Metric value={vehicles.length} label="Vehicules" />
              <Metric value={pendingCount} label="En attente" />
            </div>
          </div>
        </div>
      </section>

      <div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--card)] p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setTab("rooms")}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            tab === "rooms" ? "bg-brand-500 text-white shadow-sm" : "text-[var(--foreground)]"
          }`}
        >
          Reservation de salles
        </button>
        <button
          type="button"
          onClick={() => setTab("vehicles")}
          className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${
            tab === "vehicles" ? "bg-brand-500 text-white shadow-sm" : "text-[var(--foreground)]"
          }`}
        >
          Reservation de vehicules
        </button>
      </div>

      {tab === "rooms" ? (
        <div className="grid gap-7 xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="premium-panel rounded-[1.5rem] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white">
                <DoorOpen className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Trouver une salle</h2>
                <p className="text-sm text-[var(--muted-foreground)]">Confirmation immediate si libre.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              <Field label="Salle">
                <Select
                  value={selectedRoomId}
                  onChange={(event) => setSelectedRoomId(event.target.value as Id<"rooms"> | "")}
                >
                  <option value="">Choisir une salle</option>
                  {activeRooms.map((room) => (
                    <option key={room._id} value={room._id}>
                      {room.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Objet de la reservation">
                <Input
                  value={roomTitle}
                  onChange={(event) => setRoomTitle(event.target.value)}
                  placeholder="Reunion equipe, entretien, formation..."
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={roomNotes}
                  onChange={(event) => setRoomNotes(event.target.value)}
                  placeholder="Materiel necessaire, accueil invite..."
                />
              </Field>
              <Button size="lg" onClick={submitRoomReservation}>
                Confirmer la reservation
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {selectedRoom ? (
              <div className="mt-6 rounded-2xl bg-[var(--accent)] p-4">
                <p className="text-sm font-semibold text-[var(--foreground)]">{selectedRoom.name}</p>
                <div className="mt-3 grid gap-2 text-sm text-[var(--muted-foreground)]">
                  <span className="inline-flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    {selectedRoom.siteLabel ?? (selectedRoom.site ? `Site ${selectedRoom.site}` : "Site non renseigne")}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {selectedRoom.capacity ? `${selectedRoom.capacity} personnes` : "Capacite non renseignee"}
                  </span>
                </div>
              </div>
            ) : null}
          </aside>

          <section className="space-y-4">
            {activeRooms.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck className="h-8 w-8" />}
                title="Aucune salle disponible"
                description="Les salles actives apparaitront ici."
              />
            ) : (
              activeRooms.map((room) => {
                const items = (reservationsByRoom.get(String(room._id)) ?? []).sort(
                  (a, b) => a.start - b.start,
                );
                return (
                  <div key={room._id} className="premium-panel overflow-hidden rounded-[1.5rem]">
                    <div className="grid gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
                      <div className="bg-[#111812] p-6 text-white">
                        <div
                          className="mb-5 h-1.5 w-16 rounded-full"
                          style={{ backgroundColor: room.color || "#47c667" }}
                        />
                        <h3 className="text-2xl font-semibold">{room.name}</h3>
                        <p className="mt-2 text-sm text-white/60">
                          {room.buildingLabel ?? room.siteLabel ?? (room.site ? `Site ${room.site}` : "Site non renseigne")}
                        </p>
                        <div className="mt-6 flex flex-wrap gap-2">
                          {(room.services ?? ["Reunion"]).slice(0, 4).map((service) => (
                            <span key={service} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/78">
                              {service}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="p-5 sm:p-6">
                        <div className="mb-4 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-[var(--foreground)]">
                              Disponibilites du creneau
                            </p>
                            <p className="text-sm text-[var(--muted-foreground)]">
                              {items.length} reservation{items.length > 1 ? "s" : ""} sur la periode.
                            </p>
                          </div>
                          <Button
                            variant={selectedRoomId === room._id ? "primary" : "secondary"}
                            onClick={() => setSelectedRoomId(room._id)}
                          >
                            Choisir
                          </Button>
                        </div>
                        {items.length === 0 ? (
                          <div className="rounded-2xl border border-dashed border-brand-500/35 bg-brand-50 px-4 py-5 text-sm font-medium text-brand-800">
                            Aucun conflit: cette salle semble libre sur le creneau choisi.
                          </div>
                        ) : (
                          <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
                            {items.map((reservation) => (
                              <div key={reservation._id} className="data-row p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                  <div>
                                    <p className="font-semibold text-[var(--foreground)]">{reservation.title}</p>
                                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                                      {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                                    </p>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => cancelRoomReservation({ reservationId: reservation._id })}
                                  >
                                    <X className="h-4 w-4" />
                                    Annuler
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-7 xl:grid-cols-[420px_minmax(0,1fr)]">
          <aside className="premium-panel rounded-[1.5rem] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white">
                <CarFront className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-[var(--foreground)]">Demander un vehicule</h2>
                <p className="text-sm text-[var(--muted-foreground)]">Validation requise avant utilisation.</p>
              </div>
            </div>
            <div className="mt-6 grid gap-4">
              <Field label="Vehicule">
                <Select
                  value={selectedVehicleId}
                  onChange={(event) => setSelectedVehicleId(event.target.value as Id<"vehicles"> | "")}
                >
                  <option value="">Choisir un vehicule</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle._id} value={vehicle._id}>
                      {vehicle.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Motif">
                <Textarea
                  value={vehiclePurpose}
                  onChange={(event) => setVehiclePurpose(event.target.value)}
                  placeholder="Collecte, rendez-vous partenaire, livraison..."
                />
              </Field>
              <Button size="lg" onClick={submitVehicleRequest}>
                Envoyer la demande
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {selectedVehicle ? (
              <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--border)]">
                {selectedVehicle.photoUrl ? (
                  <img src={selectedVehicle.photoUrl} alt={selectedVehicle.name} className="h-40 w-full object-cover" />
                ) : (
                  <div className="flex h-40 items-center justify-center bg-[#111812] text-white">
                    <CarFront className="h-12 w-12" />
                  </div>
                )}
                <div className="p-4">
                  <p className="font-semibold text-[var(--foreground)]">{selectedVehicle.name}</p>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {[selectedVehicle.brand, selectedVehicle.model, selectedVehicle.plate].filter(Boolean).join(" · ") ||
                      selectedVehicle.kind}
                  </p>
                </div>
              </div>
            ) : null}
          </aside>

          <section className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              {vehicles.map((vehicle) => (
                <div key={vehicle._id} className="premium-panel overflow-hidden rounded-[1.5rem]">
                  <div className="grid grid-cols-[132px_minmax(0,1fr)]">
                    {vehicle.photoUrl ? (
                      <img src={vehicle.photoUrl} alt={vehicle.name} className="h-full min-h-36 w-full object-cover" />
                    ) : (
                      <div className="flex min-h-36 items-center justify-center bg-[#111812] text-white">
                        <CarFront className="h-9 w-9" />
                      </div>
                    )}
                    <div className="p-5">
                      <p className="text-lg font-semibold text-[var(--foreground)]">{vehicle.name}</p>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {[vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(" · ") || vehicle.kind}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-[var(--foreground)]">
                          {vehicle.seats ? `${vehicle.seats} places` : vehicle.kind}
                        </span>
                        <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-[var(--foreground)]">
                          {vehicle.siteLabel ?? (vehicle.site ? `Site ${vehicle.site}` : "Site non renseigne")}
                        </span>
                      </div>
                      <Button className="mt-5" variant="secondary" onClick={() => setSelectedVehicleId(vehicle._id)}>
                        Selectionner
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {vehicleReservations.length === 0 ? (
              <EmptyState
                icon={<CarFront className="h-8 w-8" />}
                title="Aucune demande de vehicule"
                description="Les demandes envoyees et les approbations apparaitront ici."
              />
            ) : (
              <div className="premium-panel overflow-hidden rounded-[1.5rem]">
                <div className="border-b border-[var(--border)] px-5 py-4">
                  <h3 className="text-lg font-semibold text-[var(--foreground)]">Demandes et validations</h3>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {vehicleReservations.map((reservation) => (
                    <div key={reservation._id} className="data-row p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-[var(--foreground)]">
                              {reservation.vehicle?.name ?? "Vehicule"}
                            </p>
                            <StatusBadge status={reservation.status} />
                          </div>
                          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                            {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[var(--foreground)]/82">{reservation.purpose}</p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          {canManage && reservation.status === "pending" ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() =>
                                  decideVehicleReservation({
                                    reservationId: reservation._id,
                                    decision: "approved",
                                  })
                                }
                              >
                                <Check className="h-4 w-4" />
                                Approuver
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  decideVehicleReservation({
                                    reservationId: reservation._id,
                                    decision: "rejected",
                                  })
                                }
                              >
                                <X className="h-4 w-4" />
                                Refuser
                              </Button>
                            </>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelVehicleReservation({ reservationId: reservation._id })}
                          >
                            Annuler
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.08] px-3 py-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/52">{label}</p>
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
    approved: "Approuve",
    pending: "En attente",
    rejected: "Refuse",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {status === "pending" ? <Clock3 className="h-3.5 w-3.5" /> : null}
      {labels[status]}
    </span>
  );
}
