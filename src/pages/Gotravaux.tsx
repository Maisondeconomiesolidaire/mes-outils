import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, CarFront, CheckCircle2, Gauge, Plus, Search, Wrench } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDateTime, parseLocalInput } from "../lib/format";

type VehicleKind = "utilitaire" | "camionnette" | "camion" | "voiture";
type TaskPriority = "low" | "medium" | "high";
type TaskStatus = "todo" | "in_progress" | "done";

type Vehicle = {
  _id: Id<"vehicles">;
  name: string;
  plate?: string;
  kind: VehicleKind;
  site?: "60" | "76";
  brand?: string;
  model?: string;
  seats?: number;
  assignedTo?: string;
  odometerKm?: number;
  technicalControlDate?: string;
  pollutionControlDate?: string;
  insuranceCompany?: string;
  insurancePolicy?: string;
  active: boolean;
  photoUrl?: string | null;
  openTasksCount: number;
};

type VehicleTask = {
  _id: Id<"vehicleMaintenanceTasks">;
  vehicleId: Id<"vehicles">;
  vehicle?: Vehicle | null;
  title: string;
  description?: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: number;
  createdBy: string;
};

const emptyVehicleForm = {
  name: "",
  plate: "",
  kind: "utilitaire" as VehicleKind,
  site: "" as "" | "60" | "76",
  brand: "",
  model: "",
  seats: "",
  assignedTo: "",
  photoUrl: "",
  odometerKm: "",
  technicalControlDate: "",
  pollutionControlDate: "",
  insuranceCompany: "",
  insurancePolicy: "",
  active: true,
};

export function Gotravaux() {
  const vehicles = useQuery(api.gotravaux.listVehicles) as Vehicle[] | undefined;
  const tasks = useQuery(api.gotravaux.listVehicleTasks, {}) as VehicleTask[] | undefined;
  const createVehicle = useMutation(api.gotravaux.createVehicle);
  const updateVehicle = useMutation(api.gotravaux.updateVehicle);
  const createTask = useMutation(api.gotravaux.createVehicleTask);
  const updateTask = useMutation(api.gotravaux.updateVehicleTask);

  const [selectedVehicleId, setSelectedVehicleId] = useState<Id<"vehicles"> | "">("");
  const [form, setForm] = useState(emptyVehicleForm);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState<TaskPriority>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"active" | "inactive" | "all">("active");

  const selectedVehicle = vehicles?.find((vehicle) => vehicle._id === selectedVehicleId);

  useEffect(() => {
    if (!selectedVehicle) return;
    setForm({
      name: selectedVehicle.name,
      plate: selectedVehicle.plate ?? "",
      kind: selectedVehicle.kind,
      site: selectedVehicle.site ?? "",
      brand: selectedVehicle.brand ?? "",
      model: selectedVehicle.model ?? "",
      seats: selectedVehicle.seats ? String(selectedVehicle.seats) : "",
      assignedTo: selectedVehicle.assignedTo ?? "",
      photoUrl: selectedVehicle.photoUrl ?? "",
      odometerKm: selectedVehicle.odometerKm ? String(selectedVehicle.odometerKm) : "",
      technicalControlDate: selectedVehicle.technicalControlDate ?? "",
      pollutionControlDate: selectedVehicle.pollutionControlDate ?? "",
      insuranceCompany: selectedVehicle.insuranceCompany ?? "",
      insurancePolicy: selectedVehicle.insurancePolicy ?? "",
      active: selectedVehicle.active,
    });
  }, [selectedVehicle]);

  const filteredVehicles = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (vehicles ?? []).filter((vehicle) => {
      if (statusTab === "active" && !vehicle.active) return false;
      if (statusTab === "inactive" && vehicle.active) return false;
      if (!normalized) return true;
      return [vehicle.name, vehicle.brand, vehicle.model, vehicle.plate, vehicle.kind]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [vehicles, search, statusTab]);

  if (vehicles === undefined || tasks === undefined) {
    return <FullSpinner label="Chargement de Gotravaux..." />;
  }

  async function saveVehicle() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name,
      plate: form.plate || undefined,
      kind: form.kind,
      site: form.site || undefined,
      brand: form.brand || undefined,
      model: form.model || undefined,
      seats: form.seats ? Number(form.seats) : undefined,
      assignedTo: form.assignedTo || undefined,
      photoUrl: form.photoUrl || undefined,
      odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined,
      technicalControlDate: form.technicalControlDate || undefined,
      pollutionControlDate: form.pollutionControlDate || undefined,
      insuranceCompany: form.insuranceCompany || undefined,
      insurancePolicy: form.insurancePolicy || undefined,
      active: form.active,
    };
    if (selectedVehicleId) {
      await updateVehicle({ vehicleId: selectedVehicleId, ...payload });
    } else {
      await createVehicle(payload);
      setForm(emptyVehicleForm);
    }
  }

  async function addTask() {
    if (!selectedVehicleId || !taskTitle.trim()) return;
    await createTask({
      vehicleId: selectedVehicleId,
      title: taskTitle,
      description: taskDescription || undefined,
      priority: taskPriority,
      dueDate: taskDueDate ? parseLocalInput(taskDueDate) : undefined,
    });
    setTaskTitle("");
    setTaskDescription("");
    setTaskPriority("medium");
    setTaskDueDate("");
  }

  return (
    <div className="grid gap-7 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="premium-panel h-fit rounded-[1.5rem] p-5 lg:sticky lg:top-32">
        <p className="text-xl font-bold text-[var(--foreground)]">Go travaux</p>
        <nav className="mt-8 space-y-2 text-sm font-semibold">
          {["Planning", "Liste tâches", "Véhicules", "Réservations", "Equipements"].map((item) => (
            <span
              key={item}
              className={`flex items-center gap-3 rounded-2xl px-3 py-3 ${
                item === "Véhicules" ? "bg-brand-50 text-brand-700" : "text-[var(--muted-foreground)]"
              }`}
            >
              <CarFront className="h-4 w-4" />
              {item}
            </span>
          ))}
        </nav>
      </aside>

      <main className="space-y-7">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-[var(--foreground)]">
              Véhicules ({vehicles.length})
            </h1>
            <div className="mt-7 flex gap-8 text-xl font-medium">
              <button
                type="button"
                onClick={() => setStatusTab("active")}
                className={`border-b-2 pb-3 ${statusTab === "active" ? "border-brand-500 text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)]"}`}
              >
                Actif
              </button>
              <button
                type="button"
                onClick={() => setStatusTab("inactive")}
                className={`border-b-2 pb-3 ${statusTab === "inactive" ? "border-brand-500 text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)]"}`}
              >
                Immobilisé
              </button>
              <button
                type="button"
                onClick={() => setStatusTab("all")}
                className={`border-b-2 pb-3 ${statusTab === "all" ? "border-brand-500 text-[var(--foreground)]" : "border-transparent text-[var(--muted-foreground)]"}`}
              >
                Tous
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => {
                setSelectedVehicleId("");
                setForm(emptyVehicleForm);
              }}
            >
              <Plus className="h-5 w-5" />
              Ajouter un véhicule
            </Button>
            <label className="flex h-12 min-w-72 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 shadow-sm">
              <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Marque, modèle, immatriculation..."
                className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {filteredVehicles.map((vehicle) => (
              <button
                key={vehicle._id}
                type="button"
                onClick={() => setSelectedVehicleId(vehicle._id)}
                className={`overflow-hidden rounded-[1.4rem] border bg-[var(--card)] text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-xl ${
                  selectedVehicleId === vehicle._id ? "border-brand-500 ring-4 ring-brand-500/15" : "border-[var(--border)]"
                }`}
              >
                <div className="asset-photo relative h-56">
                  {vehicle.photoUrl ? (
                    <img src={vehicle.photoUrl} alt={vehicle.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--muted-foreground)]">
                      <CarFront className="h-12 w-12" />
                      <span className="text-sm font-semibold">Photo à ajouter</span>
                    </div>
                  )}
                  <span className="absolute left-4 top-4 rounded-full bg-brand-500 px-3 py-2 text-sm font-bold text-white">
                    {vehicle.active ? "Actif" : "Inactif"}
                  </span>
                  {vehicle.plate ? (
                    <span className="absolute right-4 top-4 rounded-lg border-2 border-black bg-white px-4 py-2 text-sm font-black text-black shadow">
                      {vehicle.plate}
                    </span>
                  ) : null}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-bold text-[var(--foreground)]">{vehicle.name}</h2>
                    <span className="text-sm font-semibold text-[var(--muted-foreground)]">{vehicle.kind}</span>
                  </div>
                  <div className="mt-5 space-y-3 text-sm font-semibold text-[var(--foreground)]">
                    <p>Année {vehicle.technicalControlDate?.slice(0, 4) || vehicle.pollutionControlDate?.slice(0, 4) || "non renseignée"}</p>
                    <p>
                      {vehicle.odometerKm ? `${vehicle.odometerKm.toLocaleString("fr-FR")} km` : "Kilométrage inconnu"}
                    </p>
                    <p>{vehicle.brand || "Marque non renseignée"}</p>
                  </div>
                </div>
              </button>
            ))}
          </section>

          <aside className="space-y-5">
          <section className="premium-panel rounded-[1.5rem] p-5">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">
              {selectedVehicleId ? "Modifier le vehicule" : "Nouveau vehicule"}
            </h2>
            <div className="mt-5 grid gap-4">
              <Field label="Nom">
                <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </Field>
              <Field label="Photo">
                <Input value={form.photoUrl} onChange={(event) => setForm({ ...form, photoUrl: event.target.value })} placeholder="URL de la photo" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Marque">
                  <Input value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} />
                </Field>
                <Field label="Modele">
                  <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Plaque">
                  <Input value={form.plate} onChange={(event) => setForm({ ...form, plate: event.target.value })} />
                </Field>
                <Field label="Type">
                  <Select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value as VehicleKind })}>
                    <option value="utilitaire">Utilitaire</option>
                    <option value="camionnette">Camionnette</option>
                    <option value="camion">Camion</option>
                    <option value="voiture">Voiture</option>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Site">
                  <Select value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value as "" | "60" | "76" })}>
                    <option value="">Non renseigne</option>
                    <option value="60">Site 60</option>
                    <option value="76">Site 76</option>
                  </Select>
                </Field>
                <Field label="Places">
                  <Input type="number" value={form.seats} onChange={(event) => setForm({ ...form, seats: event.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Kilometrage">
                  <Input type="number" value={form.odometerKm} onChange={(event) => setForm({ ...form, odometerKm: event.target.value })} />
                </Field>
                <Field label="Attribue a">
                  <Input value={form.assignedTo} onChange={(event) => setForm({ ...form, assignedTo: event.target.value })} />
                </Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Controle technique">
                  <Input value={form.technicalControlDate} onChange={(event) => setForm({ ...form, technicalControlDate: event.target.value })} />
                </Field>
                <Field label="Pollution">
                  <Input value={form.pollutionControlDate} onChange={(event) => setForm({ ...form, pollutionControlDate: event.target.value })} />
                </Field>
              </div>
              <Button onClick={saveVehicle}>
                <CheckCircle2 className="h-4 w-4" />
                Enregistrer
              </Button>
            </div>
          </section>

          <section className="premium-panel rounded-[1.5rem] p-5">
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Nouvelle maintenance</h2>
            <div className="mt-5 grid gap-4">
              <Field label="Vehicule">
                <Select
                  value={selectedVehicleId}
                  onChange={(event) => setSelectedVehicleId(event.target.value as Id<"vehicles"> | "")}
                >
                  <option value="">Selectionner</option>
                  {vehicles.map((vehicle) => (
                    <option key={vehicle._id} value={vehicle._id}>{vehicle.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Tache">
                <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Vidange, pneu, controle..." />
              </Field>
              <Field label="Description">
                <Textarea value={taskDescription} onChange={(event) => setTaskDescription(event.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Priorite">
                  <Select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as TaskPriority)}>
                    <option value="low">Basse</option>
                    <option value="medium">Moyenne</option>
                    <option value="high">Haute</option>
                  </Select>
                </Field>
                <Field label="Echeance">
                  <Input
                    type="datetime-local"
                    value={taskDueDate}
                    onChange={(event) => setTaskDueDate(event.target.value)}
                  />
                </Field>
              </div>
              <Button onClick={addTask} variant="secondary">
                <Plus className="h-4 w-4" />
                Ajouter la tache
              </Button>
            </div>
          </section>
          </aside>
        </div>

      <section className="premium-panel overflow-hidden rounded-[1.5rem]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Plan de maintenance</h2>
        </div>
        {tasks.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-8 w-8" />}
            title="Aucune tache"
            description="Les maintenances et travaux vehicules apparaitront ici."
          />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {tasks.map((task) => (
              <div key={task._id} className="data-row grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-[var(--foreground)]">{task.title}</p>
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {task.vehicle?.name ?? "Vehicule"} · cree par {task.createdBy}
                  </p>
                  {task.description ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--foreground)]/82">{task.description}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <CalendarClock className="h-4 w-4" />
                  {task.dueDate ? formatDateTime(task.dueDate) : "Sans echeance"}
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={task.status}
                    onChange={(event) =>
                      updateTask({
                        taskId: task._id,
                        status: event.target.value as TaskStatus,
                        priority: task.priority,
                      })
                    }
                  >
                    <option value="todo">A faire</option>
                    <option value="in_progress">En cours</option>
                    <option value="done">Terminee</option>
                  </Select>
                  <Gauge className="h-4 w-4 text-[var(--muted-foreground)]" />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      </main>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const map = {
    low: "bg-zinc-100 text-zinc-700",
    medium: "bg-amber-100 text-amber-800",
    high: "bg-rose-100 text-rose-800",
  };
  const label = { low: "Basse", medium: "Moyenne", high: "Haute" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[priority]}`}>{label[priority]}</span>;
}
