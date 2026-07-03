import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, DoorOpen, Info, Plus, Save, Trash2, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSearchParams } from "react-router-dom";
import { SectionHeader } from "../components/SectionHeader";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { SinglePhotoUpload } from "../components/ui/SinglePhotoUpload";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDate, formatDateTime } from "../lib/format";
import { canAccess } from "../lib/permissions";
import { CalendarBoard, type CalendarEvent } from "../components/ui/CalendarBoard";
import { SectionTabs } from "../components/ui/SectionTabs";
import { confirmPermanentDelete } from "../lib/confirm";

type Room = {
  _id: Id<"rooms">;
  name: string;
  site?: "60" | "76";
  capacity?: number;
  photo?: Id<"_storage">;
  photoUrl?: string | null;
  siteLabel?: string;
  buildingLabel?: string;
  reservable?: boolean;
  active: boolean;
};

type RoomReservation = {
  _id: Id<"roomReservations">;
  roomId: Id<"rooms">;
  title: string;
  usageType?: string;
  attendees?: number;
  userName: string;
  bookedByName?: string;
  start: number;
  end: number;
  notes?: string;
};

const emptyRoomForm = {
  name: "",
  site: "" as "" | "60" | "76",
  capacity: "",
  photo: null as Id<"_storage"> | null,
  photoUrl: "",
  buildingLabel: "",
  reservable: true,
  active: true,
};
type RoomFormState = typeof emptyRoomForm;

export function Salles() {
  const access = usePermissionsAccess();
  const canSeeReservations = canAccess(access, "mesoutils:reservations", "read");
  const canCreate = canAccess(access, "mesoutils:salles", "create");
  const canEdit = canAccess(access, "mesoutils:salles", "update");
  const rooms = useQuery(api.gotravaux.listRooms) as Room[] | undefined;
  const createRoom = useMutation(api.gotravaux.createRoom);
  const updateRoom = useMutation(api.gotravaux.updateRoom);

  const [searchParams] = useSearchParams();
  const sub = searchParams.get("v") ?? "rooms";
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<Id<"rooms"> | "">("");
  const [form, setForm] = useState(emptyRoomForm);
  const [saving, setSaving] = useState(false);

  const editingRoom = rooms?.find((room) => room._id === editingId);

  useEffect(() => {
    if (!modalOpen) return;
    if (editingRoom) {
      setForm({
        name: editingRoom.name,
        site: editingRoom.site ?? "",
        capacity: editingRoom.capacity ? String(editingRoom.capacity) : "",
        photo: editingRoom.photo ?? null,
        photoUrl: editingRoom.photoUrl ?? "",
        buildingLabel: editingRoom.buildingLabel ?? "",
        reservable: editingRoom.reservable ?? true,
        active: editingRoom.active,
      });
    } else {
      setForm(emptyRoomForm);
    }
  }, [modalOpen, editingRoom]);

  if (rooms === undefined) {
    return <FullSpinner label="Chargement des salles..." />;
  }

  function openCreate() {
    setEditingId("");
    setModalOpen(true);
  }
  function openEdit(roomId: Id<"rooms">) {
    setEditingId(roomId);
    setModalOpen(true);
  }

  function roomPayload(nextForm: RoomFormState) {
    return {
      name: nextForm.name,
      site: nextForm.site || undefined,
      capacity: nextForm.capacity ? Number(nextForm.capacity) : undefined,
      photo: nextForm.photo ?? undefined,
      photoUrl: nextForm.photoUrl || undefined,
      buildingLabel: nextForm.buildingLabel || undefined,
      reservable: nextForm.reservable,
      active: nextForm.active,
    };
  }

  async function persistRoom(nextForm: RoomFormState, closeAfterSave = false) {
    if (!nextForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = roomPayload(nextForm);
      if (editingId) {
        await updateRoom({ roomId: editingId, ...payload });
      } else {
        await createRoom(payload);
      }
      if (closeAfterSave) setModalOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function updateRoomForm(patch: Partial<RoomFormState>) {
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    if (editingId && canEdit) void persistRoom(nextForm);
  }

  const actions =
    sub === "rooms" && canCreate ? (
      <Button size="lg" onClick={openCreate}>
        <Plus className="h-5 w-5" />
        Nouvelle salle
      </Button>
    ) : undefined;

  return (
    <>
      <div className="space-y-6">
        <SectionHeader title="Gestion des salles" actions={actions} />
        <SectionTabs />
        {sub === "rooms" ? (
          rooms.length === 0 ? (
            <EmptyState icon={<DoorOpen className="h-8 w-8" />} title="Aucune salle" description="Ajoutez votre première salle réservable." />
          ) : (
            <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {rooms.map((room) => (
                <article
                  key={room._id}
                  onClick={canEdit ? () => openEdit(room._id) : undefined}
                  className={`group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:shadow-md ${canEdit ? "cursor-pointer" : ""}`}
                >
                  <div className="relative aspect-video overflow-hidden bg-[var(--muted)]">
                    {room.photoUrl ? (
                      <img src={room.photoUrl} alt={room.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]">
                        <DoorOpen className="h-10 w-10" />
                      </div>
                    )}
                    <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold ${room.active ? "bg-brand-500 text-white" : "bg-zinc-500 text-white"}`}>
                      {room.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="p-4">
                    <h2 className="text-lg font-bold text-[var(--foreground)]">{room.name}</h2>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {room.buildingLabel || room.siteLabel || (room.site ? `Site ${room.site}` : "Site —")}
                    </p>
                    <div className="mt-3 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                      <Users className="h-4 w-4" />
                      {room.capacity ? `${room.capacity} personnes` : "Capacité —"}
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )
        ) : null}

        {sub === "reservations" && canSeeReservations ? <RoomReservationsAgenda rooms={rooms} mode="agenda" /> : null}
        {sub === "calendar" && canSeeReservations ? <RoomReservationsAgenda rooms={rooms} mode="calendar" /> : null}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Modifier la salle" : "Nouvelle salle"}>
        <div className="grid gap-4">
          <SinglePhotoUpload className="mx-auto w-full max-w-3xl" value={form.photo} previewUrl={form.photoUrl || null} onChange={(id) => updateRoomForm({ photo: id })} />
          <Field label="Nom" required>
            <Input value={form.name} onChange={(event) => updateRoomForm({ name: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Site">
              <Select value={form.site} onChange={(event) => updateRoomForm({ site: event.target.value as "" | "60" | "76" })}>
                <option value="">Non renseigné</option>
                <option value="60">Site 60</option>
                <option value="76">Site 76</option>
              </Select>
            </Field>
            <Field label="Capacité">
              <Input type="number" value={form.capacity} onChange={(event) => updateRoomForm({ capacity: event.target.value })} />
            </Field>
          </div>
          <Field label="Bâtiment / zone">
            <Input value={form.buildingLabel} onChange={(event) => updateRoomForm({ buildingLabel: event.target.value })} />
          </Field>
          <Field label="Statut">
            <Select value={form.active ? "active" : "inactive"} onChange={(event) => updateRoomForm({ active: event.target.value === "active" })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          {editingId ? (
            <p className="border-t border-[var(--border)] pt-3 text-right text-xs font-medium text-[var(--muted-foreground)]">{saving ? "Enregistrement..." : "Modifications enregistrées automatiquement"}</p>
          ) : (
            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Annuler</Button>
              <Button size="lg" onClick={() => persistRoom(form, true)} disabled={saving || !form.name.trim()}>
                <Save className="h-4 w-4" />
                {saving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}

function RoomReservationsAgenda({ rooms, mode }: { rooms: Room[]; mode: "agenda" | "calendar" }) {
  // Borne la fenêtre au début du jour (et non à la milliseconde) pour que les
  // arguments de la query restent identiques d'un rendu à l'autre. Sinon Convex
  // considère chaque rendu comme une nouvelle souscription et relance la query
  // en boucle (compteur d'appels anormalement élevé).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  const reservations = useQuery(api.reservations.listRoomReservations, {
    start: dayStart - 86_400_000,
    end: dayStart + 60 * 86_400_000,
  }) as RoomReservation[] | undefined;
  const cancel = useMutation(api.reservations.cancelRoomReservation);
  const roomName = new Map(rooms.map((room) => [String(room._id), room]));
  const [selectedReservationId, setSelectedReservationId] = useState<Id<"roomReservations"> | null>(null);

  if (reservations === undefined) return <FullSpinner label="Chargement du planning..." />;

  const upcoming = [...reservations].sort((a, b) => a.start - b.start);
  const selectedReservation = reservations.find((reservation) => reservation._id === selectedReservationId) ?? null;
  const events: CalendarEvent[] = upcoming.map((reservation) => {
    const room = roomName.get(String(reservation.roomId));
    return {
      id: String(reservation._id),
      start: reservation.start,
      end: reservation.end,
      title: `${room?.name ?? "Salle"} · ${reservation.title}`,
      subtitle: reservation.userName,
      tone: "brand",
    };
  });

  if (mode === "calendar") {
    return (
      <div className="space-y-3">
        <CalendarBoard
          events={events}
          selected={dayStart}
          onEventClick={(id) => setSelectedReservationId(id as Id<"roomReservations">)}
        />
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Aucune réservation de salle sur la période affichée.</p>
        ) : null}
        <RoomReservationDetailsModal
          reservation={selectedReservation}
          room={selectedReservation ? roomName.get(String(selectedReservation.roomId)) ?? null : null}
          onClose={() => setSelectedReservationId(null)}
          onCancel={(reservationId) => {
            cancelReservationWithConfirmation(reservationId);
            setSelectedReservationId(null);
          }}
        />
      </div>
    );
  }

  if (upcoming.length === 0) {
    return <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Aucune réservation" description="Le planning des salles à venir s'affichera ici." />;
  }

  const byDay = new Map<string, typeof upcoming>();
  for (const reservation of upcoming) {
    const key = formatDate(reservation.start);
    byDay.set(key, [...(byDay.get(key) ?? []), reservation]);
  }

  function cancelReservationWithConfirmation(reservationId: Id<"roomReservations">) {
    if (!confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement cette réservation de salle ?")) return;
    void cancel({ reservationId });
  }

  return (
    <div className="space-y-5">
      {Array.from(byDay.entries()).map(([day, items]) => (
        <section key={day} className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--border)] bg-[var(--accent)] px-5 py-2.5">
            <p className="text-sm font-bold capitalize text-[var(--foreground)]">{day}</p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {items.map((reservation) => {
              const room = roomName.get(String(reservation.roomId));
              return (
                <div key={reservation._id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                  <span className="h-9 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {reservation.title} · {room?.name ?? "Salle"}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                    </p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => setSelectedReservationId(reservation._id)}>
                    <Info className="h-4 w-4" />Détails
                  </Button>
                  <button
                    type="button"
                    onClick={() => cancelReservationWithConfirmation(reservation._id)}
                    className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600"
                    title="Annuler"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <RoomReservationDetailsModal
        reservation={selectedReservation}
        room={selectedReservation ? roomName.get(String(selectedReservation.roomId)) ?? null : null}
        onClose={() => setSelectedReservationId(null)}
        onCancel={(reservationId) => {
          cancelReservationWithConfirmation(reservationId);
          setSelectedReservationId(null);
        }}
      />
    </div>
  );
}

function RoomReservationDetailsModal({
  reservation,
  room,
  onClose,
  onCancel,
}: {
  reservation: RoomReservation | null;
  room: Room | null;
  onClose: () => void;
  onCancel: (reservationId: Id<"roomReservations">) => void;
}) {
  if (!reservation) return null;

  return (
    <Modal open onClose={onClose} title="Détail de la réservation salle" className="sm:max-w-4xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--muted)]">
          {room?.photoUrl ? (
            <img src={room.photoUrl} alt={room.name} className="h-full max-h-[60vh] min-h-64 w-full object-cover" />
          ) : (
            <div className="flex min-h-64 items-center justify-center text-[var(--muted-foreground)]">
              <DoorOpen className="h-14 w-14" />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-500/20 dark:text-brand-200">
              Réservation confirmée
            </span>
            {reservation.usageType ? (
              <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--muted-foreground)]">
                {reservation.usageType}
              </span>
            ) : null}
          </div>

          <h2 className="mt-3 text-2xl font-bold text-[var(--foreground)]">{reservation.title}</h2>
          <p className="mt-1 text-sm font-semibold text-[var(--muted-foreground)]">{room?.name ?? "Salle"}</p>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <DetailItem label="Salle" value={room?.name ?? "Salle"} />
            <DetailItem label="Bâtiment / zone" value={room?.buildingLabel ?? room?.siteLabel ?? (room?.site ? `Site ${room.site}` : "Non renseigné")} />
            <DetailItem label="Réservé pour" value={reservation.userName} />
            <DetailItem label="Réservé par" value={reservation.bookedByName ?? reservation.userName} />
            <DetailItem label="Début" value={formatDateTime(reservation.start)} />
            <DetailItem label="Fin" value={formatDateTime(reservation.end)} />
            <DetailItem label="Participants" value={reservation.attendees ? `${reservation.attendees} personne${reservation.attendees > 1 ? "s" : ""}` : "Non renseigné"} />
            <DetailItem label="Capacité" value={room?.capacity ? `${room.capacity} personnes` : "Non renseignée"} />
          </dl>

          {reservation.notes ? (
            <div className="mt-4 rounded-xl border border-[var(--border)] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Note</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{reservation.notes}</p>
            </div>
          ) : null}

          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={onClose}>Fermer</Button>
            <Button variant="outline" onClick={() => onCancel(reservation._id)}>
              <Trash2 className="h-4 w-4" />Annuler la réservation
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] px-3 py-2">
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="mt-1 font-semibold text-[var(--foreground)]">{value}</dd>
    </div>
  );
}
