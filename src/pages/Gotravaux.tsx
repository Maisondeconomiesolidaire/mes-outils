import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Activity, CalendarClock, CarFront, CheckCircle2, Gauge, Plus, Wrench } from "lucide-react";
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
      odometerKm: selectedVehicle.odometerKm ? String(selectedVehicle.odometerKm) : "",
      technicalControlDate: selectedVehicle.technicalControlDate ?? "",
      pollutionControlDate: selectedVehicle.pollutionControlDate ?? "",
      insuranceCompany: selectedVehicle.insuranceCompany ?? "",
      insurancePolicy: selectedVehicle.insurancePolicy ?? "",
      active: selectedVehicle.active,
    });
  }, [selectedVehicle]);

  const openTasks = useMemo(
    () => (tasks ?? []).filter((task) => task.status !== "done"),
    [tasks],
  );

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
    <div className="space-y-8">
      <section className="premium-shell rounded-[2rem] bg-[#111812] p-7 text-white sm:p-10">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-brand-300">Gotravaux</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">Gestion de flotte et maintenance.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-white/68">
              Centralisez les informations vehicules, les affectations, les controles et les travaux a realiser.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <HeroStat icon={<CarFront className="h-5 w-5" />} value={vehicles.length} label="Vehicules" />
            <HeroStat icon={<Wrench className="h-5 w-5" />} value={openTasks.length} label="Taches" />
            <HeroStat icon={<Activity className="h-5 w-5" />} value={vehicles.filter((v) => v.active).length} label="Actifs" />
          </div>
        </div>
      </section>

      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_430px]">
        <section className="premium-panel overflow-hidden rounded-[1.5rem]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--foreground)]">Parc vehicules</h2>
              <p className="text-sm text-[var(--muted-foreground)]">Cliquez une ligne pour modifier ses informations.</p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setSelectedVehicleId("");
                setForm(emptyVehicleForm);
              }}
            >
              <Plus className="h-4 w-4" />
              Nouveau
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-[var(--accent)] text-xs uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-5 py-3">Vehicule</th>
                  <th className="px-5 py-3">Plaque</th>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-5 py-3">Kilometrage</th>
                  <th className="px-5 py-3">Maintenance</th>
                  <th className="px-5 py-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map((vehicle) => (
                  <tr
                    key={vehicle._id}
                    className={`data-row cursor-pointer ${selectedVehicleId === vehicle._id ? "bg-brand-50" : ""}`}
                    onClick={() => setSelectedVehicleId(vehicle._id)}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        {vehicle.photoUrl ? (
                          <img src={vehicle.photoUrl} alt={vehicle.name} className="h-11 w-11 rounded-xl object-cover" />
                        ) : (
                          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#111812] text-white">
                            <CarFront className="h-5 w-5" />
                          </span>
                        )}
                        <div>
                          <p className="font-semibold text-[var(--foreground)]">{vehicle.name}</p>
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {[vehicle.brand, vehicle.model].filter(Boolean).join(" ") || vehicle.kind}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[var(--foreground)]">{vehicle.plate ?? "-"}</td>
                    <td className="px-5 py-4 text-[var(--muted-foreground)]">{vehicle.site ? `Site ${vehicle.site}` : "-"}</td>
                    <td className="px-5 py-4 text-[var(--muted-foreground)]">
                      {vehicle.odometerKm ? `${vehicle.odometerKm.toLocaleString("fr-FR")} km` : "-"}
                    </td>
                    <td className="px-5 py-4">
                      <span className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs font-semibold text-[var(--foreground)]">
                        {vehicle.openTasksCount} ouverte{vehicle.openTasksCount > 1 ? "s" : ""}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${vehicle.active ? "bg-brand-100 text-brand-800" : "bg-zinc-100 text-zinc-600"}`}>
                        {vehicle.active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}

function HeroStat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <div className="min-w-24 rounded-2xl bg-white/[0.08] px-4 py-4">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white">
        {icon}
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs uppercase tracking-[0.14em] text-white/52">{label}</p>
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
