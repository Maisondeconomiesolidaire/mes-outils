import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarDays, DoorOpen, Pencil, Plus, Save, Trash2, Users } from "lucide-react";
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
                <article key={room._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:shadow-md">
                  <div className="relative aspect-video bg-[var(--muted)]">
                    {room.photoUrl ? (
                      <img src={room.photoUrl} alt={room.name} className="h-full w-full object-cover" />
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
                    {canEdit ? (
                      <Button variant="secondary" size="sm" className="mt-4 w-full" onClick={() => openEdit(room._id)}>
                        <Pencil className="h-4 w-4" />
                        Modifier la salle
                      </Button>
                    ) : null}
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
          <SinglePhotoUpload value={form.photo} previewUrl={form.photoUrl || null} onChange={(id) => updateRoomForm({ photo: id })} />
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
  const now = Date.now();
  const reservations = useQuery(api.reservations.listRoomReservations, {
    start: now - 86_400_000,
    end: now + 60 * 86_400_000,
  }) as
    | Array<{
        _id: Id<"roomReservations">;
        roomId: Id<"rooms">;
        title: string;
        userName: string;
        start: number;
        end: number;
      }>
    | undefined;
  const cancel = useMutation(api.reservations.cancelRoomReservation);
  const roomName = new Map(rooms.map((room) => [String(room._id), room]));

  if (reservations === undefined) return <FullSpinner label="Chargement du planning..." />;

  const upcoming = [...reservations].sort((a, b) => a.start - b.start);
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
        <CalendarBoard events={events} selected={now} />
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">Aucune réservation de salle sur la période affichée.</p>
        ) : null}
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
                <div key={reservation._id} className="flex items-center gap-4 px-5 py-3">
                  <span className="h-9 w-1.5 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {reservation.title} · {room?.name ?? "Salle"}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-foreground)]">
                      {reservation.userName} · {formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cancel({ reservationId: reservation._id })}
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
    </div>
  );
}
