import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Building2, DoorOpen, Plus, Save, Users } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "../components/ui/Button";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";

type Room = {
  _id: Id<"rooms">;
  name: string;
  site?: "60" | "76";
  capacity?: number;
  color?: string;
  siteLabel?: string;
  buildingLabel?: string;
  services?: string[];
  reservable?: boolean;
  unavailabilityNotes?: string;
  active: boolean;
};

const emptyRoomForm = {
  name: "",
  site: "" as "" | "60" | "76",
  capacity: "",
  color: "#47c667",
  buildingLabel: "",
  services: "",
  reservable: true,
  unavailabilityNotes: "",
  active: true,
};

export function Salles() {
  const rooms = useQuery(api.gotravaux.listRooms) as Room[] | undefined;
  const createRoom = useMutation(api.gotravaux.createRoom);
  const updateRoom = useMutation(api.gotravaux.updateRoom);

  const [selectedRoomId, setSelectedRoomId] = useState<Id<"rooms"> | "">("");
  const [form, setForm] = useState(emptyRoomForm);

  const selectedRoom = rooms?.find((room) => room._id === selectedRoomId);

  useEffect(() => {
    if (!selectedRoom) return;
    setForm({
      name: selectedRoom.name,
      site: selectedRoom.site ?? "",
      capacity: selectedRoom.capacity ? String(selectedRoom.capacity) : "",
      color: selectedRoom.color ?? "#47c667",
      buildingLabel: selectedRoom.buildingLabel ?? "",
      services: (selectedRoom.services ?? []).join(", "),
      reservable: selectedRoom.reservable ?? true,
      unavailabilityNotes: selectedRoom.unavailabilityNotes ?? "",
      active: selectedRoom.active,
    });
  }, [selectedRoom]);

  if (rooms === undefined) {
    return <FullSpinner label="Chargement des salles..." />;
  }

  async function saveRoom() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name,
      site: form.site || undefined,
      capacity: form.capacity ? Number(form.capacity) : undefined,
      color: form.color || undefined,
      buildingLabel: form.buildingLabel || undefined,
      services: form.services
        .split(",")
        .map((service) => service.trim())
        .filter(Boolean),
      reservable: form.reservable,
      unavailabilityNotes: form.unavailabilityNotes || undefined,
      active: form.active,
    };

    if (selectedRoomId) {
      await updateRoom({ roomId: selectedRoomId, ...payload });
    } else {
      await createRoom(payload);
      setForm(emptyRoomForm);
    }
  }

  return (
    <div className="space-y-8">
      <section className="premium-shell rounded-[2rem] bg-[#111812] p-7 text-white sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-300">Salles</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Gestion des espaces reservables.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/68">
              Gardez un inventaire propre des salles, capacites, services, sites et disponibilites.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <HeroMetric value={rooms.length} label="Salles" />
            <HeroMetric value={rooms.filter((room) => room.active).length} label="Actives" />
            <HeroMetric value={rooms.filter((room) => room.reservable !== false).length} label="Reservables" />
          </div>
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="premium-panel overflow-hidden rounded-[1.5rem]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Inventaire des salles</h2>
              <p className="text-sm text-[var(--muted-foreground)]">Selectionnez une salle pour l'administrer.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedRoomId("");
                setForm(emptyRoomForm);
              }}
            >
              <Plus className="h-4 w-4" />
              Nouvelle
            </Button>
          </div>

          <div className="grid divide-y divide-[var(--border)]">
            {rooms.map((room) => (
              <button
                key={room._id}
                type="button"
                onClick={() => setSelectedRoomId(room._id)}
                className={`data-row grid gap-4 px-5 py-5 text-left transition md:grid-cols-[minmax(0,1fr)_180px_150px] ${
                  selectedRoomId === room._id ? "bg-brand-50" : ""
                }`}
              >
                <div className="flex items-start gap-4">
                  <span
                    className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
                    style={{ backgroundColor: room.color || "#47c667" }}
                  >
                    <DoorOpen className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="font-semibold text-[var(--foreground)]">{room.name}</p>
                    <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                      {room.buildingLabel || room.siteLabel || (room.site ? `Site ${room.site}` : "Site non renseigne")}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(room.services ?? []).slice(0, 4).map((service) => (
                        <span key={service} className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-[var(--foreground)]">
                          {service}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <Users className="h-4 w-4" />
                  {room.capacity ? `${room.capacity} personnes` : "Capacite non renseignee"}
                </div>
                <div className="flex items-center">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${room.active ? "bg-brand-100 text-brand-800" : "bg-zinc-100 text-zinc-600"}`}>
                    {room.active ? "Active" : "Inactive"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <aside className="premium-panel rounded-[1.5rem] p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500 text-white">
              <Building2 className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                {selectedRoomId ? "Modifier la salle" : "Nouvelle salle"}
              </h2>
              <p className="text-sm text-[var(--muted-foreground)]">Informations visibles dans la reservation.</p>
            </div>
          </div>

          <div className="mt-6 grid gap-4">
            <Field label="Nom">
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Site">
                <Select value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value as "" | "60" | "76" })}>
                  <option value="">Non renseigne</option>
                  <option value="60">Site 60</option>
                  <option value="76">Site 76</option>
                </Select>
              </Field>
              <Field label="Capacite">
                <Input type="number" value={form.capacity} onChange={(event) => setForm({ ...form, capacity: event.target.value })} />
              </Field>
            </div>
            <Field label="Batiment / zone">
              <Input value={form.buildingLabel} onChange={(event) => setForm({ ...form, buildingLabel: event.target.value })} />
            </Field>
            <Field label="Services">
              <Input
                value={form.services}
                onChange={(event) => setForm({ ...form, services: event.target.value })}
                placeholder="Projecteur, Visio, Tableau..."
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Couleur">
                <Input
                  type="color"
                  value={form.color}
                  onChange={(event) => setForm({ ...form, color: event.target.value })}
                  className="h-11 p-1.5"
                />
              </Field>
              <Field label="Statut">
                <Select
                  value={form.active ? "active" : "inactive"}
                  onChange={(event) => setForm({ ...form, active: event.target.value === "active" })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
            </div>
            <Field label="Notes d'indisponibilite">
              <Textarea
                value={form.unavailabilityNotes}
                onChange={(event) => setForm({ ...form, unavailabilityNotes: event.target.value })}
              />
            </Field>
            <Button size="lg" onClick={saveRoom}>
              <Save className="h-4 w-4" />
              Enregistrer la salle
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function HeroMetric({ value, label }: { value: number; label: string }) {
  return (
    <div className="min-w-24 rounded-2xl bg-white/[0.08] px-4 py-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/52">{label}</p>
    </div>
  );
}
