import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, CarFront, Check, Plus, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { defaultEnd, defaultStart, formatDateTime, parseLocalInput, toLocalInputValue } from "../lib/format";
import { canAccess } from "../lib/permissions";

export function Reservations() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:reservations", "manage");

  const [tab, setTab] = useState<"rooms" | "vehicles">("rooms");
  const [rangeStart, setRangeStart] = useState(toLocalInputValue(defaultStart()));
  const [rangeEnd, setRangeEnd] = useState(toLocalInputValue(defaultEnd(7, 1)));

  const rooms = useQuery(api.reservations.listRooms);
  const roomReservations = useQuery(api.reservations.listRoomReservations, {
    start: parseLocalInput(rangeStart),
    end: parseLocalInput(rangeEnd),
  });
  const vehicles = useQuery(api.reservations.listVehicles);
  const vehicleReservations = useQuery(api.reservations.listVehicleReservations, {});

  const createRoom = useMutation(api.reservations.createRoom);
  const bookRoom = useMutation(api.reservations.bookRoom);
  const cancelRoomReservation = useMutation(api.reservations.cancelRoomReservation);
  const requestVehicle = useMutation(api.reservations.requestVehicle);
  const decideVehicleReservation = useMutation(api.reservations.decideVehicleReservation);
  const cancelVehicleReservation = useMutation(api.reservations.cancelVehicleReservation);

  const [roomName, setRoomName] = useState("");
  const [roomSite, setRoomSite] = useState<"" | "60" | "76">("");
  const [roomCapacity, setRoomCapacity] = useState("");
  const [roomColor, setRoomColor] = useState("#47c667");

  const [selectedRoomId, setSelectedRoomId] = useState<Id<"rooms"> | "">("");
  const [roomTitle, setRoomTitle] = useState("");
  const [roomStart, setRoomStart] = useState(toLocalInputValue(defaultStart()));
  const [roomEnd, setRoomEnd] = useState(toLocalInputValue(defaultEnd(0, 1)));
  const [roomNotes, setRoomNotes] = useState("");

  const [selectedVehicleId, setSelectedVehicleId] = useState<Id<"vehicles"> | "">("");
  const [vehiclePurpose, setVehiclePurpose] = useState("");
  const [vehicleStart, setVehicleStart] = useState(toLocalInputValue(defaultStart()));
  const [vehicleEnd, setVehicleEnd] = useState(toLocalInputValue(defaultEnd(0, 2)));

  const reservationsByRoom = useMemo(() => {
    const map = new Map<string, NonNullable<typeof roomReservations>>();
    for (const reservation of roomReservations ?? []) {
      const current = map.get(String(reservation.roomId)) ?? [];
      current.push(reservation);
      map.set(String(reservation.roomId), current);
    }
    return map;
  }, [roomReservations]);

  if (
    rooms === undefined ||
    roomReservations === undefined ||
    vehicles === undefined ||
    vehicleReservations === undefined
  ) {
    return <FullSpinner label="Chargement des reservations..." />;
  }

  return (
    <div className="space-y-6">
      <section className="border-b border-[var(--border)] pb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="section-kicker">Reservations</p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">Salles et vehicules</h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {rooms.length} salles · {vehicles.length} vehicules ·{" "}
              {vehicleReservations.filter((item) => item.status === "pending").length} demandes en attente
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
            <button
              type="button"
              onClick={() => setTab("rooms")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "rooms" ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)]"}`}
            >
              Salles
            </button>
            <button
              type="button"
              onClick={() => setTab("vehicles")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${tab === "vehicles" ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)]"}`}
            >
              Vehicules
            </button>
          </div>
        </div>
      </section>

      {tab === "rooms" ? (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5">
            <section className="glass-card rounded-lg border border-[var(--border)] p-5">
              <h3 className="text-lg font-semibold text-[var(--foreground)]">Reserver une salle</h3>
              <div className="mt-4 grid gap-3">
                <Field label="Salle" required>
                  <Select
                    value={selectedRoomId}
                    onChange={(event) => setSelectedRoomId(event.target.value as Id<"rooms"> | "")}
                  >
                    <option value="">Selectionner</option>
                    {rooms.filter((room) => room.active).map((room) => (
                      <option key={room._id} value={room._id}>
                        {room.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Objet" required>
                  <Input value={roomTitle} onChange={(event) => setRoomTitle(event.target.value)} />
                </Field>
                <Field label="Debut" required>
                  <Input type="datetime-local" value={roomStart} onChange={(event) => setRoomStart(event.target.value)} />
                </Field>
                <Field label="Fin" required>
                  <Input type="datetime-local" value={roomEnd} onChange={(event) => setRoomEnd(event.target.value)} />
                </Field>
                <Field label="Notes">
                  <Textarea value={roomNotes} onChange={(event) => setRoomNotes(event.target.value)} />
                </Field>
                <Button
                  onClick={async () => {
                    if (!selectedRoomId || !roomTitle.trim()) return;
                    await bookRoom({
                      roomId: selectedRoomId,
                      title: roomTitle,
                      start: parseLocalInput(roomStart),
                      end: parseLocalInput(roomEnd),
                      notes: roomNotes || undefined,
                    });
                    setRoomTitle("");
                    setRoomNotes("");
                  }}
                >
                  <CalendarClock className="h-4 w-4" />
                  Reserver maintenant
                </Button>
              </div>
            </section>

            {canManage ? (
              <section className="glass-card rounded-lg border border-[var(--border)] p-5">
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Ajouter une salle</h3>
                <div className="mt-4 grid gap-3">
                  <Field label="Nom">
                    <Input value={roomName} onChange={(event) => setRoomName(event.target.value)} />
                  </Field>
                  <Field label="Site">
                    <Select value={roomSite} onChange={(event) => setRoomSite(event.target.value as "" | "60" | "76")}>
                      <option value="">Non renseigne</option>
                      <option value="60">60</option>
                      <option value="76">76</option>
                    </Select>
                  </Field>
                  <Field label="Capacite">
                    <Input value={roomCapacity} onChange={(event) => setRoomCapacity(event.target.value)} type="number" min="0" />
                  </Field>
                  <Field label="Couleur">
                    <Input value={roomColor} onChange={(event) => setRoomColor(event.target.value)} type="color" className="h-11 p-1.5" />
                  </Field>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      if (!roomName.trim()) return;
                      await createRoom({
                        name: roomName,
                        site: roomSite || undefined,
                        capacity: roomCapacity ? Number(roomCapacity) : undefined,
                        color: roomColor || undefined,
                      });
                      setRoomName("");
                      setRoomCapacity("");
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Ajouter la salle
                  </Button>
                </div>
              </section>
            ) : null}
          </div>

          <section className="space-y-4">
            <div className="glass-card rounded-lg border border-[var(--border)] p-5">
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Afficher depuis">
                  <Input type="datetime-local" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} />
                </Field>
                <Field label="Jusqu'au">
                  <Input type="datetime-local" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} />
                </Field>
              </div>
            </div>

            {rooms.length === 0 ? (
              <EmptyState
                icon={<CalendarClock className="h-8 w-8" />}
                title="Aucune salle configuree"
                description="Ajoute au moins une salle pour commencer a reserver."
              />
            ) : (
              rooms.map((room) => {
                const items = reservationsByRoom.get(String(room._id)) ?? [];
                return (
                  <div key={room._id} className="glass-card rounded-lg border border-[var(--border)] p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: room.color || "#47c667" }}
                        />
                        <div>
                          <h3 className="font-semibold text-[var(--foreground)]">{room.name}</h3>
                          <p className="text-sm text-[var(--muted-foreground)]">
                            {room.site ? `Site ${room.site}` : "Site non renseigne"}
                            {room.capacity ? ` · ${room.capacity} pers.` : ""}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${room.active ? "bg-brand-100 text-brand-800" : "bg-zinc-100 text-zinc-600"}`}>
                        {room.active ? "Active" : "Inactive"}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      {items.length === 0 ? (
                        <div className="rounded-lg bg-[var(--accent)] px-4 py-3 text-sm text-[var(--muted-foreground)]">
                          Aucun creneau sur la periode.
                        </div>
                      ) : (
                        items
                          .sort((a, b) => a.start - b.start)
                          .map((reservation) => (
                            <div key={reservation._id} className="rounded-lg bg-[var(--accent)]/70 px-4 py-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <p className="font-medium text-[var(--foreground)]">{reservation.title}</p>
                                  <p className="text-sm text-[var(--muted-foreground)]">
                                    {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                                  </p>
                                  {reservation.notes ? (
                                    <p className="mt-1 text-sm text-[var(--foreground)]/80">{reservation.notes}</p>
                                  ) : null}
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
                          ))
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="glass-card rounded-lg border border-[var(--border)] p-5">
            <h3 className="text-lg font-semibold text-[var(--foreground)]">Demander un vehicule</h3>
            <div className="mt-4 grid gap-3">
              <Field label="Vehicule" required>
                <Select
                  value={selectedVehicleId}
                  onChange={(event) => setSelectedVehicleId(event.target.value as Id<"vehicles"> | "")}
                >
                  <option value="">Selectionner</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle._id} value={vehicle._id}>
                      {vehicle.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Motif" required>
                <Textarea value={vehiclePurpose} onChange={(event) => setVehiclePurpose(event.target.value)} />
              </Field>
              <Field label="Debut" required>
                <Input type="datetime-local" value={vehicleStart} onChange={(event) => setVehicleStart(event.target.value)} />
              </Field>
              <Field label="Fin" required>
                <Input type="datetime-local" value={vehicleEnd} onChange={(event) => setVehicleEnd(event.target.value)} />
              </Field>
              <Button
                onClick={async () => {
                  if (!selectedVehicleId || !vehiclePurpose.trim()) return;
                  await requestVehicle({
                    vehicleId: selectedVehicleId,
                    purpose: vehiclePurpose,
                    start: parseLocalInput(vehicleStart),
                    end: parseLocalInput(vehicleEnd),
                  });
                  setVehiclePurpose("");
                }}
              >
                <CarFront className="h-4 w-4" />
                Envoyer la demande
              </Button>
            </div>
          </section>

          <section className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-2">
              {vehicles.map((vehicle) => (
                <div key={vehicle._id} className="glass-card rounded-lg border border-[var(--border)] p-5">
                  <div className="flex items-center gap-4">
                    {vehicle.photoUrl ? (
                      <img src={vehicle.photoUrl} alt={vehicle.name} className="h-16 w-16 rounded-lg object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                        <CarFront className="h-6 w-6" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-[var(--foreground)]">{vehicle.name}</h3>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        {vehicle.kind}
                        {vehicle.plate ? ` · ${vehicle.plate}` : ""}
                      </p>
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
              <div className="space-y-3">
                {vehicleReservations.map((reservation) => (
                  <div key={reservation._id} className="glass-card rounded-lg border border-[var(--border)] p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-[var(--foreground)]">
                            {reservation.vehicle?.name ?? "Vehicule"}
                          </h3>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              reservation.status === "approved"
                                ? "bg-brand-100 text-brand-800"
                                : reservation.status === "pending"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-rose-100 text-rose-800"
                            }`}
                          >
                            {reservation.status}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-[var(--foreground)]/80">{reservation.purpose}</p>
                        {reservation.decisionNote ? (
                          <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                            Note: {reservation.decisionNote}
                          </p>
                        ) : null}
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
                          <X className="h-4 w-4" />
                          Annuler
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
