import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  CalendarDays,
  CarFront,
  Check,
  FileText,
  Info,
  Plus,
  Search,
  Trash2,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { DateRangePicker, type DateRange } from "../components/ui/DateRangePicker";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { SinglePhotoUpload } from "../components/ui/SinglePhotoUpload";
import { VehicleSearchSelect } from "../components/ui/VehicleSearchSelect";
import { DatePicker } from "../components/ui/DatePicker";
import { FullSpinner } from "../components/ui/Spinner";
import { useUpload } from "../lib/useUpload";
import { formatDate, formatDateTime, relativeUnits } from "../lib/format";
import { canAccess } from "../lib/permissions";
import { CalendarBoard, type CalendarEvent } from "../components/ui/CalendarBoard";
import { SectionTabs } from "../components/ui/SectionTabs";

type VehicleKind = "utilitaire" | "voiture";
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
  odometerUpdatedAt?: string;
  saleDate?: string;
  active: boolean;
  recycappEnabled?: boolean;
  photo?: Id<"_storage">;
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
  endDate?: number;
  createdBy: string;
};

function normalizeVehicleKind(kind: string): VehicleKind {
  return kind === "voiture" ? "voiture" : "utilitaire";
}

const DOC_CATEGORIES = [
  { key: "carte_grise", label: "Carte grise" },
  { key: "facture", label: "Facture" },
  { key: "devis", label: "Devis" },
  { key: "assurance", label: "Assurance" },
  { key: "controle_technique", label: "Contrôle technique" },
  { key: "autre", label: "Autre" },
] as const;
type DocCategory = (typeof DOC_CATEGORIES)[number]["key"];

export function Gotravaux() {
  const access = usePermissionsAccess();
  const canSeeReservations = canAccess(access, "mesoutils:reservations", "read");
  const canCreate = canAccess(access, "mesoutils:gotravaux", "create");
  const canEdit = canAccess(access, "mesoutils:gotravaux", "update");
  const vehicles = useQuery(api.gotravaux.listVehicles) as Vehicle[] | undefined;
  const tasks = useQuery(api.gotravaux.listVehicleTasks, {}) as VehicleTask[] | undefined;
  const updateTask = useMutation(api.gotravaux.updateVehicleTask);

  const [searchParams] = useSearchParams();
  const sub = searchParams.get("v") ?? "vehicles";
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"active" | "immobilized" | "sold">("active");

  const [detailsVehicleId, setDetailsVehicleId] = useState<Id<"vehicles"> | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [taskModalOpen, setTaskModalOpen] = useState(false);

  const filteredVehicles = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return (vehicles ?? []).filter((vehicle) => {
      const sold = Boolean(vehicle.saleDate);
      if (statusTab === "active" && (!vehicle.active || sold)) return false;
      if (statusTab === "immobilized" && (vehicle.active || sold)) return false;
      if (statusTab === "sold" && !sold) return false;
      if (!normalized) return true;
      return [vehicle.name, vehicle.brand, vehicle.model, vehicle.plate, vehicle.kind].filter(Boolean).join(" ").toLowerCase().includes(normalized);
    });
  }, [vehicles, search, statusTab]);

  if (vehicles === undefined || tasks === undefined) return <FullSpinner label="Chargement de Gotravaux..." />;

  const detailsVehicle = vehicles.find((vehicle) => vehicle._id === detailsVehicleId) ?? null;

  const actions =
    sub === "vehicles" && canCreate ? (
      <Button size="lg" onClick={() => setCreateOpen(true)}><Plus className="h-5 w-5" />Ajouter un véhicule</Button>
    ) : sub === "tasks" && canCreate ? (
      <Button size="lg" onClick={() => setTaskModalOpen(true)}><Plus className="h-5 w-5" />Nouvelle maintenance</Button>
    ) : undefined;

  return (
    <>
      <div className="space-y-6">
        <SectionHeader title="Gotravaux" actions={actions} />
        <SectionTabs />

        {sub === "vehicles" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
                {([{ key: "active", label: "Actifs" }, { key: "immobilized", label: "Immobilisés" }, { key: "sold", label: "Vendus" }] as const).map((option) => (
                  <button key={option.key} type="button" onClick={() => setStatusTab(option.key)} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${statusTab === option.key ? "bg-brand-500 text-white" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex h-11 min-w-64 flex-1 items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--card)] px-4 sm:flex-none sm:min-w-72">
                <Search className="h-4 w-4 text-[var(--muted-foreground)]" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Marque, modèle, immatriculation..." className="w-full bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]" />
              </label>
            </div>

            {filteredVehicles.length === 0 ? (
              <EmptyState icon={<CarFront className="h-8 w-8" />} title="Aucun véhicule" description="Ajoutez un véhicule pour démarrer le suivi." />
            ) : (
              <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {filteredVehicles.map((vehicle) => (
                  <article key={vehicle._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:shadow-md">
                    <div className="relative aspect-video bg-[var(--muted)]">
                      {vehicle.photoUrl ? (
                        <img src={vehicle.photoUrl} alt={vehicle.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--muted-foreground)]"><CarFront className="h-10 w-10" /><span className="text-sm font-semibold">Photo à ajouter</span></div>
                      )}
                      <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold text-white ${vehicle.saleDate ? "bg-rose-500" : vehicle.active ? "bg-brand-500" : "bg-zinc-500"}`}>{vehicle.saleDate ? "Vendu" : vehicle.active ? "Actif" : "Immobilisé"}</span>
                      {vehicle.plate ? <span className="absolute right-3 top-3 rounded-md border-2 border-black bg-white px-2.5 py-1 text-xs font-black text-black">{vehicle.plate}</span> : null}
                      {vehicle.openTasksCount > 0 ? <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white"><Wrench className="h-3.5 w-3.5" />{vehicle.openTasksCount}</span> : null}
                    </div>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="text-lg font-bold text-[var(--foreground)]">{vehicle.name}</h2>
                        <span className="text-sm font-semibold capitalize text-[var(--muted-foreground)]">{vehicle.kind}</span>
                      </div>
                      <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <dt className="inline-flex items-center gap-1.5 text-[var(--muted-foreground)]"><Users className="h-4 w-4" />Places</dt>
                          <dd className="font-semibold text-[var(--foreground)]">{vehicle.seats ?? "—"}</dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt className="text-[var(--muted-foreground)]">Kilométrage</dt>
                          <dd className="text-right">
                            <span className="font-semibold text-[var(--foreground)]">{vehicle.odometerKm ? `${vehicle.odometerKm.toLocaleString("fr-FR")} km` : "—"}</span>
                            {vehicle.odometerKm && relativeUnits(vehicle.odometerUpdatedAt) ? (
                              <span className="block text-xs text-[var(--muted-foreground)]">Dernier relevé {relativeUnits(vehicle.odometerUpdatedAt)}</span>
                            ) : null}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <dt className="text-[var(--muted-foreground)]">Marque</dt>
                          <dd className="font-semibold text-[var(--foreground)]">{vehicle.brand || "—"}</dd>
                        </div>
                      </dl>
                      <Button variant="secondary" className="mt-4 w-full" onClick={() => setDetailsVehicleId(vehicle._id)}>Détails</Button>
                    </div>
                  </article>
                ))}
              </section>
            )}
          </div>
        ) : null}

        {sub === "tasks" ? <TaskList tasks={tasks} onUpdate={updateTask} canEdit={canEdit} /> : null}
        {sub === "reservations" && canSeeReservations ? <VehicleReservationsPanel /> : null}
        {sub === "calendar" ? (
          <FleetCalendar
            vehicles={vehicles}
            tasks={tasks}
            canSeeReservations={canSeeReservations}
            canEdit={canEdit}
            onOpenVehicle={(vehicleId) => setDetailsVehicleId(vehicleId)}
            onUpdateTask={updateTask}
          />
        ) : null}
      </div>

      {/* Création d'un véhicule (Informations seulement) */}
      <CreateVehicleModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Détails d'un véhicule existant : 3 onglets */}
      {detailsVehicle ? (
        <VehicleDetailsModal vehicle={detailsVehicle} onClose={() => setDetailsVehicleId(null)} canCreate={canCreate} canEdit={canEdit} />
      ) : null}

      {/* Maintenance globale (avec sélecteur de véhicule) */}
      <TaskModal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} vehicles={vehicles} />
    </>
  );
}

/* ─── Formulaire véhicule (Informations) ─────────────────────────────────── */

type VehicleStatus = "active" | "immobilized" | "sold";

const emptyVehicleForm = {
  name: "", plate: "", kind: "utilitaire" as VehicleKind, site: "" as "" | "60" | "76",
  brand: "", model: "", seats: "", assignedTo: "", photo: null as Id<"_storage"> | null, photoUrl: "",
  odometerKm: "", technicalControlDate: "", pollutionControlDate: "", status: "active" as VehicleStatus,
  recycappEnabled: false,
};
type VehicleFormState = typeof emptyVehicleForm;

function VehicleInfoForm({ vehicle, onSaved, canSave = true }: { vehicle: Vehicle | null; onSaved: () => void; canSave?: boolean }) {
  const createVehicle = useMutation(api.gotravaux.createVehicle);
  const updateVehicle = useMutation(api.gotravaux.updateVehicle);
  const [form, setForm] = useState<VehicleFormState>(() =>
    vehicle
      ? {
          name: vehicle.name, plate: vehicle.plate ?? "", kind: normalizeVehicleKind(vehicle.kind), site: vehicle.site ?? ("" as "" | "60" | "76"),
          brand: vehicle.brand ?? "", model: vehicle.model ?? "", seats: vehicle.seats ? String(vehicle.seats) : "",
          assignedTo: vehicle.assignedTo ?? "", photo: vehicle.photo ?? null, photoUrl: vehicle.photoUrl ?? "",
          odometerKm: vehicle.odometerKm ? String(vehicle.odometerKm) : "",
          technicalControlDate: vehicle.technicalControlDate ?? "", pollutionControlDate: vehicle.pollutionControlDate ?? "",
          status: vehicle.saleDate ? ("sold" as VehicleStatus) : vehicle.active ? ("active" as VehicleStatus) : ("immobilized" as VehicleStatus),
          recycappEnabled: vehicle.recycappEnabled === true,
        }
      : emptyVehicleForm,
  );
  const [saving, setSaving] = useState(false);

  function payloadFromForm(nextForm: VehicleFormState) {
    return {
      name: nextForm.name, plate: nextForm.plate || undefined, kind: nextForm.kind,
      site: (nextForm.site || undefined) as "60" | "76" | undefined,
      brand: nextForm.brand || undefined, model: nextForm.model || undefined, seats: nextForm.seats ? Number(nextForm.seats) : undefined,
      assignedTo: nextForm.assignedTo || undefined, photo: nextForm.photo ?? undefined, photoUrl: nextForm.photoUrl || undefined,
      odometerKm: nextForm.odometerKm ? Number(nextForm.odometerKm) : undefined,
      technicalControlDate: nextForm.technicalControlDate || undefined, pollutionControlDate: nextForm.pollutionControlDate || undefined,
      active: nextForm.status === "active",
      recycappEnabled: nextForm.recycappEnabled,
    };
  }

  async function persist(nextForm: VehicleFormState, closeAfterSave = false) {
    if (!nextForm.name.trim()) return;
    setSaving(true);
    try {
      const payload = payloadFromForm(nextForm);
      const saleDate = nextForm.status === "sold" ? (vehicle?.saleDate || new Date().toISOString().slice(0, 10)) : undefined;
      if (vehicle) await updateVehicle({ vehicleId: vehicle._id, ...payload, saleDate });
      else await createVehicle(payload);
      if (closeAfterSave) onSaved();
    } finally {
      setSaving(false);
    }
  }

  function updateForm(patch: Partial<VehicleFormState>) {
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    if (vehicle && canSave) void persist(nextForm);
  }

  return (
    <fieldset disabled={!canSave} className="grid gap-4">
      <SinglePhotoUpload className="mx-auto w-full max-w-3xl" value={form.photo} previewUrl={form.photoUrl || null} onChange={(id) => updateForm({ photo: id })} />
      <Field label="Nom" required><Input value={form.name} onChange={(e) => updateForm({ name: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Marque"><Input value={form.brand} onChange={(e) => updateForm({ brand: e.target.value })} /></Field>
        <Field label="Modèle"><Input value={form.model} onChange={(e) => updateForm({ model: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plaque"><Input value={form.plate} onChange={(e) => updateForm({ plate: e.target.value })} /></Field>
        <Field label="Type">
          <Select value={form.kind} onChange={(e) => updateForm({ kind: e.target.value as VehicleKind })}>
            <option value="utilitaire">Utilitaire</option><option value="voiture">Voiture</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Site">
          <Select value={form.site} onChange={(e) => updateForm({ site: e.target.value as "" | "60" | "76" })}>
            <option value="">Non renseigné</option><option value="60">Site 60</option><option value="76">Site 76</option>
          </Select>
        </Field>
        <Field label="Places"><Input type="number" value={form.seats} onChange={(e) => updateForm({ seats: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Kilométrage"
          hint={vehicle?.odometerUpdatedAt ? `Dernier relevé : ${formatDateTime(Date.parse(vehicle.odometerUpdatedAt))}` : "Aucun relevé enregistré."}
        >
          <Input type="number" value={form.odometerKm} onChange={(e) => updateForm({ odometerKm: e.target.value })} />
        </Field>
        <Field label="Attribué à"><Input value={form.assignedTo} onChange={(e) => updateForm({ assignedTo: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contrôle technique"><DatePicker value={form.technicalControlDate} onChange={(value) => updateForm({ technicalControlDate: value })} /></Field>
        <Field label="Contrôle pollution"><DatePicker value={form.pollutionControlDate} onChange={(value) => updateForm({ pollutionControlDate: value })} /></Field>
      </div>
      <Field label="Statut">
        <Select value={form.status} onChange={(e) => updateForm({ status: e.target.value as VehicleStatus })}>
          <option value="active">Actif</option>
          <option value="immobilized">Immobilisé</option>
          <option value="sold">Vendu</option>
        </Select>
      </Field>
      <label className="rounded-xl border border-[var(--border)] bg-[var(--accent)] p-4">
        <span className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.recycappEnabled}
            onChange={(e) => updateForm({ recycappEnabled: e.target.checked })}
            className="mt-1 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="block text-sm font-semibold text-[var(--foreground)]">
              Disponible pour la Recyclerie
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
              Si activé, ce véhicule apparaît dans la flotte et les affectations de la Recyclerie.
            </span>
          </span>
        </span>
      </label>
      {canSave && !vehicle ? (
        <div className="flex justify-end border-t border-[var(--border)] pt-4">
          <Button size="lg" onClick={() => persist(form, true)} disabled={saving || !form.name.trim()}>{saving ? "Enregistrement..." : "Enregistrer"}</Button>
        </div>
      ) : null}
      {canSave && vehicle ? <p className="border-t border-[var(--border)] pt-3 text-right text-xs font-medium text-[var(--muted-foreground)]">{saving ? "Enregistrement..." : "Modifications enregistrées automatiquement"}</p> : null}
    </fieldset>
  );
}

function CreateVehicleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Nouveau véhicule">
      <VehicleInfoForm vehicle={null} onSaved={onClose} />
    </Modal>
  );
}

/* ─── Modal détails véhicule (3 onglets) ─────────────────────────────────── */

function VehicleDetailsModal({ vehicle, onClose, canCreate, canEdit }: { vehicle: Vehicle; onClose: () => void; canCreate: boolean; canEdit: boolean }) {
  const [tab, setTab] = useState<"info" | "maintenance" | "documents">("info");
  const tabs = [
    { key: "info" as const, label: "Informations", icon: Info },
    { key: "maintenance" as const, label: "Maintenances", icon: Wrench },
    { key: "documents" as const, label: "Documents", icon: FileText },
  ];

  return (
    <Modal open onClose={onClose} title={vehicle.name}>
      <div className="mb-4 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--accent)] p-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === item.key ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
              <Icon className="h-4 w-4" />{item.label}
            </button>
          );
        })}
      </div>

      {tab === "info" ? <VehicleInfoForm vehicle={vehicle} onSaved={onClose} canSave={canEdit} /> : null}
      {tab === "maintenance" ? <VehicleMaintenanceTab vehicleId={vehicle._id} canCreate={canCreate} canEdit={canEdit} /> : null}
      {tab === "documents" ? <VehicleDocumentsTab vehicleId={vehicle._id} canEdit={canEdit} /> : null}
    </Modal>
  );
}

function VehicleMaintenanceTab({ vehicleId, canCreate, canEdit }: { vehicleId: Id<"vehicles">; canCreate: boolean; canEdit: boolean }) {
  const tasks = useQuery(api.gotravaux.listVehicleTasks, { vehicleId }) as VehicleTask[] | undefined;
  const createTask = useMutation(api.gotravaux.createVehicleTask);
  const updateTask = useMutation(api.gotravaux.updateVehicleTask);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!title.trim() || !range.start) return;
    setSaving(true);
    try {
      await createTask({ vehicleId, title, priority, dueDate: range.start, endDate: range.end ?? undefined });
      setTitle("");
      setPriority("medium");
      setRange({ start: null, end: null });
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {adding ? (
        <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--accent)] p-4">
          <Field label="Intitulé" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vidange, pneu, contrôle..." /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Période" required><DateRangePicker value={range} onChange={setRange} placeholder="Période de maintenance" /></Field>
            <Field label="Priorité">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}><option value="low">Basse</option><option value="medium">Moyenne</option><option value="high">Haute</option></Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuler</Button>
            <Button size="sm" onClick={add} disabled={saving || !title.trim() || !range.start}>{saving ? "Ajout..." : "Ajouter"}</Button>
          </div>
        </div>
      ) : canCreate ? (
        <Button className="w-full" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Nouvelle maintenance</Button>
      ) : null}

      {tasks === undefined ? (
        <FullSpinner label="Chargement..." />
      ) : tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">Aucune maintenance pour ce véhicule.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={task._id} className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2"><p className="font-semibold text-[var(--foreground)]">{task.title}</p><PriorityBadge priority={task.priority} /></div>
                <Select value={task.status} disabled={!canEdit} onChange={(e) => updateTask({ taskId: task._id, status: e.target.value as TaskStatus, priority: task.priority })} className="h-9 w-auto">
                  <option value="todo">À faire</option><option value="in_progress">En cours</option><option value="done">Terminée</option>
                </Select>
              </div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {task.dueDate ? formatDate(task.dueDate) : "Sans date"}{task.endDate && task.endDate !== task.dueDate ? ` → ${formatDate(task.endDate)}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VehicleDocumentsTab({ vehicleId, canEdit }: { vehicleId: Id<"vehicles">; canEdit: boolean }) {
  const documents = useQuery(api.gotravaux.listVehicleDocuments, { vehicleId });
  const addDocument = useMutation(api.gotravaux.addVehicleDocument);
  const removeDocument = useMutation(api.gotravaux.removeVehicleDocument);
  const upload = useUpload();
  const [uploadingCategory, setUploadingCategory] = useState<DocCategory | null>(null);

  async function handleFile(category: DocCategory, file: File | undefined) {
    if (!file) return;
    setUploadingCategory(category);
    try {
      const storageId = await upload(file);
      await addDocument({ vehicleId, name: file.name, category, storageId });
    } finally {
      setUploadingCategory(null);
    }
  }

  return (
    <div className="space-y-6">
      {canEdit ? (
        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Ajouter un document</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_CATEGORIES.map((category) => (
              <label key={category.key} className="flex min-h-24 cursor-pointer flex-col justify-between rounded-2xl border border-[var(--border)] bg-[var(--accent)] p-4 transition hover:border-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                <span className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--card)] text-brand-600">
                    <FileText className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-bold text-[var(--foreground)]">{category.label}</span>
                </span>
                <span className="mt-3 text-xs font-medium text-[var(--muted-foreground)]">
                  {uploadingCategory === category.key ? "Import en cours..." : "Cliquer pour importer"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    void handleFile(category.key, e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                  disabled={uploadingCategory !== null}
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 border-t border-[var(--border)] pt-5">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Documents ajoutés</h3>
        {documents === undefined ? (
          <FullSpinner label="Chargement..." />
        ) : documents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--muted-foreground)]">Aucun document ajouté.</p>
        ) : (
          <div className="space-y-2">
            {documents.map((document) => (
              <div key={document._id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
                <FileText className="h-5 w-5 shrink-0 text-brand-600" />
                <a href={document.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)] hover:underline">{document.name}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{DOC_CATEGORIES.find((c) => c.key === document.category)?.label} · {document.uploadedBy}</p>
                </a>
                {canEdit ? <button type="button" onClick={() => removeDocument({ documentId: document._id })} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─── Maintenance globale ────────────────────────────────────────────────── */

function TaskModal({ open, onClose, vehicles }: { open: boolean; onClose: () => void; vehicles: Vehicle[] }) {
  const createTask = useMutation(api.gotravaux.createVehicleTask);
  const [vehicleId, setVehicleId] = useState<Id<"vehicles"> | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vehicleId || !title.trim() || !range.start) return;
    setSaving(true);
    try {
      await createTask({ vehicleId, title, description: description || undefined, priority, dueDate: range.start, endDate: range.end ?? undefined });
      setVehicleId(""); setTitle(""); setDescription(""); setPriority("medium"); setRange({ start: null, end: null });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Nouvelle maintenance">
      <div className="grid gap-4">
        <Field label="Véhicule" required>
          <VehicleSearchSelect
            vehicles={vehicles.map((v) => ({ _id: v._id, name: v.name, brand: v.brand, model: v.model, plate: v.plate, photoUrl: v.photoUrl }))}
            value={vehicleId}
            onChange={(id) => setVehicleId(id as Id<"vehicles">)}
          />
        </Field>
        <Field label="Intitulé" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vidange, pneu, contrôle..." /></Field>
        <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Période" required><DateRangePicker value={range} onChange={setRange} placeholder="Période de maintenance" /></Field>
          <Field label="Priorité">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}><option value="low">Basse</option><option value="medium">Moyenne</option><option value="high">Haute</option></Select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={save} disabled={saving || !vehicleId || !title.trim() || !range.start}>{saving ? "Ajout..." : "Ajouter"}</Button>
        </div>
      </div>
    </Modal>
  );
}

function TaskList({ tasks, onUpdate, canEdit }: { tasks: VehicleTask[]; onUpdate: ReturnType<typeof useMutation>; canEdit: boolean }) {
  if (tasks.length === 0) return <EmptyState icon={<Wrench className="h-8 w-8" />} title="Aucune maintenance" description="Les maintenances apparaîtront ici." />;
  return (
    <section className="premium-panel overflow-hidden rounded-2xl">
      <div className="divide-y divide-[var(--border)]">
        {tasks.map((task) => (
          <div key={task._id} className="data-row grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px_180px] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--foreground)]">{task.title}</p><PriorityBadge priority={task.priority} /></div>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">{task.vehicle?.name ?? "Véhicule"} · créé par {task.createdBy}</p>
              {task.description ? <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{task.description}</p> : null}
            </div>
            <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
              <CalendarClock className="h-4 w-4" />
              {task.dueDate ? formatDate(task.dueDate) : "Sans date"}{task.endDate && task.endDate !== task.dueDate ? ` → ${formatDate(task.endDate)}` : ""}
            </div>
            <Select value={task.status} disabled={!canEdit} onChange={(e) => onUpdate({ taskId: task._id, status: e.target.value as TaskStatus, priority: task.priority })}>
              <option value="todo">À faire</option><option value="in_progress">En cours</option><option value="done">Terminée</option>
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
}

type AgendaEntry =
  | {
      id: string;
      kind: "task";
      task: VehicleTask;
      date: number;
      endDate?: number;
      label: string;
      sublabel: string;
      tone: "maintenance";
    }
  | {
      id: string;
      kind: "reservation";
      reservation: ReservationItem;
      date: number;
      endDate?: number;
      label: string;
      sublabel: string;
      tone: "reservation" | "pending";
    };

function FleetCalendar({
  vehicles,
  tasks,
  canSeeReservations,
  canEdit,
  onOpenVehicle,
  onUpdateTask,
}: {
  vehicles: Vehicle[];
  tasks: VehicleTask[];
  canSeeReservations: boolean;
  canEdit: boolean;
  onOpenVehicle: (vehicleId: Id<"vehicles">) => void;
  onUpdateTask: ReturnType<typeof useMutation>;
}) {
  const access = usePermissionsAccess();
  const canManageReservations = canAccess(access, "mesoutils:reservations", "manage");
  const reservations = useQuery(api.reservations.listVehicleReservations, canSeeReservations ? {} : "skip") as ReservationItem[] | undefined;
  const decide = useMutation(api.reservations.decideVehicleReservation);
  const cancel = useMutation(api.reservations.cancelVehicleReservation);
  const [selectedDay, setSelectedDay] = useState(() => startOfDayTimestamp(Date.now()));
  const [selectedReservationId, setSelectedReservationId] = useState<Id<"vehicleReservations"> | null>(null);
  const entries: AgendaEntry[] = [];
  const vehicleName = new Map(vehicles.map((v) => [String(v._id), v.name]));

  for (const task of tasks) {
    if (task.status === "done" || !task.dueDate) continue;
    entries.push({
      id: `task-${task._id}`,
      kind: "task",
      task,
      date: task.dueDate,
      endDate: task.endDate,
      label: `Maintenance · ${task.vehicle?.name ?? vehicleName.get(String(task.vehicleId)) ?? "Véhicule"}`,
      sublabel: task.title,
      tone: "maintenance",
    });
  }
  for (const reservation of reservations ?? []) {
    if (reservation.status === "rejected") continue;
    entries.push({
      id: `reservation-${reservation._id}`,
      kind: "reservation",
      reservation,
      date: reservation.start,
      endDate: reservation.end,
      label: `${reservation.vehicle?.name ?? "Véhicule"} · ${reservation.userName}`,
      sublabel: reservation.purpose,
      tone: reservation.status === "approved" ? "reservation" : "pending",
    });
  }

  const toneStyles = { reservation: "border-l-brand-500", maintenance: "border-l-amber-500", pending: "border-l-sky-500" };
  const calendarEvents: CalendarEvent[] = entries.map((entry) => ({
    id: entry.id,
    start: entry.date,
    end: entry.endDate,
    title: entry.label,
    subtitle: entry.sublabel,
    tone: entry.tone === "maintenance" ? "amber" : entry.tone === "pending" ? "sky" : "brand",
  }));
  const selectedDayEntries = entries
    .filter((entry) => overlapsDay(entry.date, entry.endDate, selectedDay))
    .sort((a, b) => a.date - b.date);
  const selectedReservation = reservations?.find((reservation) => reservation._id === selectedReservationId) ?? null;

  async function decideAndClose(reservationId: Id<"vehicleReservations">, decision: "approved" | "rejected") {
    await decide({ reservationId, decision });
    setSelectedReservationId(null);
  }

  function handleEventClick(id: string, day?: Date) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    setSelectedDay(startOfDayTimestamp((day ?? new Date(entry.date)).getTime()));
    if (entry.kind === "reservation") setSelectedReservationId(entry.reservation._id);
    else onOpenVehicle(entry.task.vehicleId);
  }

  return (
    <div className="space-y-5">
      <CalendarBoard
        events={calendarEvents}
        selected={selectedDay}
        onSelect={(day) => setSelectedDay(startOfDayTimestamp(day.getTime()))}
        onEventClick={handleEventClick}
      />
      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] bg-[var(--accent)] px-5 py-3">
          <p className="text-sm font-bold capitalize text-[var(--foreground)]">{formatDate(selectedDay)}</p>
        </div>
        {selectedDayEntries.length === 0 ? (
          <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Agenda vide" description="Aucune réservation ou maintenance sur cette journée." />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {selectedDayEntries.map((entry) => (
              <div key={entry.id} className={`flex flex-wrap items-center gap-4 border-l-4 px-5 py-3 ${toneStyles[entry.tone]}`}>
                <span className="w-14 shrink-0 text-sm font-semibold text-[var(--foreground)]">{formatDateTime(entry.date).slice(-5)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[var(--foreground)]">{entry.label}</p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">{entry.sublabel}</p>
                  {entry.endDate ? <p className="text-xs text-[var(--muted-foreground)]">{formatDateTime(entry.date)} → {formatDateTime(entry.endDate)}</p> : null}
                </div>
                {entry.tone === "pending" ? <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">En attente</span> : null}
                {entry.kind === "reservation" ? (
                  <Button size="sm" variant="secondary" onClick={() => setSelectedReservationId(entry.reservation._id)}>
                    <Info className="h-4 w-4" />Détails
                  </Button>
                ) : (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={() => onOpenVehicle(entry.task.vehicleId)}>
                      <Info className="h-4 w-4" />Véhicule
                    </Button>
                    <Select
                      value={entry.task.status}
                      disabled={!canEdit}
                      onChange={(event) =>
                        onUpdateTask({
                          taskId: entry.task._id,
                          status: event.target.value as TaskStatus,
                          priority: entry.task.priority,
                        })
                      }
                      className="h-9 w-auto"
                    >
                      <option value="todo">À faire</option>
                      <option value="in_progress">En cours</option>
                      <option value="done">Terminée</option>
                    </Select>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <ReservationDetailsModal
        reservation={selectedReservation}
        canManage={canManageReservations}
        onClose={() => setSelectedReservationId(null)}
        onApprove={(reservationId) => decideAndClose(reservationId, "approved")}
        onReject={(reservationId) => decideAndClose(reservationId, "rejected")}
        onCancel={(reservationId) => {
          void cancel({ reservationId });
          setSelectedReservationId(null);
        }}
      />
    </div>
  );
}

function startOfDayTimestamp(input: number) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDayTimestamp(input: number) {
  const date = new Date(input);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function overlapsDay(start: number, end: number | undefined, dayStart: number) {
  const dayEnd = endOfDayTimestamp(dayStart);
  return start <= dayEnd && (end ?? start) >= dayStart;
}

function VehicleReservationsPanel() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:reservations", "manage");
  const reservations = useQuery(api.reservations.listVehicleReservations, {}) as ReservationItem[] | undefined;
  const decide = useMutation(api.reservations.decideVehicleReservation);
  const cancel = useMutation(api.reservations.cancelVehicleReservation);
  const [selectedId, setSelectedId] = useState<Id<"vehicleReservations"> | null>(null);

  if (reservations === undefined) return <FullSpinner label="Chargement des réservations..." />;
  if (reservations.length === 0) return <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="Aucune réservation" description="Les demandes de réservation apparaîtront ici." />;

  const pending = reservations.filter((r) => r.status === "pending");
  const others = reservations.filter((r) => r.status !== "pending");
  const selected = reservations.find((reservation) => reservation._id === selectedId) ?? null;

  async function decideAndClose(reservationId: Id<"vehicleReservations">, decision: "approved" | "rejected") {
    await decide({ reservationId, decision });
    setSelectedId(null);
  }

  return (
    <div className="space-y-6">
      {pending.length > 0 ? (
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-lg font-semibold text-[var(--foreground)]">À traiter ({pending.length})</h2></div>
          <div className="divide-y divide-[var(--border)]">
            {pending.map((r) => (
              <ReservationRow key={r._id} reservation={r} canManage={canManage} onOpen={() => setSelectedId(r._id)} onCancel={() => cancel({ reservationId: r._id })} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-lg font-semibold text-[var(--foreground)]">Historique</h2></div>
        <div className="divide-y divide-[var(--border)]">
          {others.map((r) => <ReservationRow key={r._id} reservation={r} canManage={canManage} onOpen={() => setSelectedId(r._id)} onCancel={() => cancel({ reservationId: r._id })} />)}
        </div>
      </section>

      <ReservationDetailsModal
        reservation={selected}
        canManage={canManage}
        onClose={() => setSelectedId(null)}
        onApprove={(reservationId) => decideAndClose(reservationId, "approved")}
        onReject={(reservationId) => decideAndClose(reservationId, "rejected")}
        onCancel={(reservationId) => {
          void cancel({ reservationId });
          setSelectedId(null);
        }}
      />
    </div>
  );
}

type ReservationItem = {
  _id: Id<"vehicleReservations">;
  vehicle?: { name?: string; brand?: string; model?: string; plate?: string } | null;
  vehiclePhotoUrl?: string | null;
  clerkId: string;
  userName: string;
  bookedByName?: string;
  purpose: string;
  usageType?: "pro" | "personal";
  expectedKm?: number;
  willTransport?: boolean;
  transportDetails?: string;
  start: number;
  end: number;
  status: "pending" | "approved" | "rejected";
  decisionNote?: string;
  decidedBy?: string;
  decidedAt?: number;
};

function ReservationRow({ reservation, canManage, onOpen, onCancel }: { reservation: ReservationItem; canManage: boolean; onOpen: () => void; onCancel: () => void }) {
  return (
    <div className="data-row flex flex-wrap items-center gap-4 p-5">
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--muted)]">
        {reservation.vehiclePhotoUrl ? <img src={reservation.vehiclePhotoUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]"><CarFront className="h-6 w-6" /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--foreground)]">{reservation.vehicle?.name ?? "Véhicule"}</p><StatusBadge status={reservation.status} /></div>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{reservation.userName}{reservation.bookedByName ? ` (par ${reservation.bookedByName})` : ""} · {reservation.purpose}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{formatDateTime(reservation.start)} → {formatDateTime(reservation.end)}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant={reservation.status === "pending" && canManage ? "primary" : "secondary"} onClick={onOpen}>
          <Info className="h-4 w-4" />Détails
        </Button>
        <button type="button" onClick={onCancel} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600" title="Annuler"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function ReservationDetailsModal({
  reservation,
  canManage,
  onClose,
  onApprove,
  onReject,
  onCancel,
}: {
  reservation: ReservationItem | null;
  canManage: boolean;
  onClose: () => void;
  onApprove: (reservationId: Id<"vehicleReservations">) => Promise<void>;
  onReject: (reservationId: Id<"vehicleReservations">) => Promise<void>;
  onCancel: (reservationId: Id<"vehicleReservations">) => void;
}) {
  const [saving, setSaving] = useState<"approved" | "rejected" | null>(null);
  if (!reservation) return null;
  const current = reservation;

  async function decide(decision: "approved" | "rejected") {
    setSaving(decision);
    try {
      if (decision === "approved") await onApprove(current._id);
      else await onReject(current._id);
    } finally {
      setSaving(null);
    }
  }

  const usageLabel = reservation.usageType === "personal" ? "Personnel" : reservation.usageType === "pro" ? "Professionnel" : "Non renseigné";
  const vehicleDetails = [reservation.vehicle?.brand, reservation.vehicle?.model, reservation.vehicle?.plate].filter(Boolean).join(" · ");

  return (
    <Modal open onClose={onClose} title="Détail de la réservation véhicule">
      <div className="grid gap-4">
        <div className="flex items-center gap-3 rounded-xl bg-[var(--accent)] px-3 py-3">
          <div className="h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--muted)]">
            {reservation.vehiclePhotoUrl ? <img src={reservation.vehiclePhotoUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]"><CarFront className="h-6 w-6" /></div>}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-[var(--foreground)]">{reservation.vehicle?.name ?? "Véhicule"}</p>
              <StatusBadge status={reservation.status} />
            </div>
            {vehicleDetails ? <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">{vehicleDetails}</p> : null}
          </div>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailItem label="Demandeur" value={reservation.userName} />
          <DetailItem label="Réservé par" value={reservation.bookedByName ?? reservation.userName} />
          <DetailItem label="Début" value={formatDateTime(reservation.start)} />
          <DetailItem label="Fin" value={formatDateTime(reservation.end)} />
          <DetailItem label="Usage" value={usageLabel} />
          <DetailItem label="Km estimés" value={reservation.expectedKm !== undefined ? `${reservation.expectedKm.toLocaleString("fr-FR")} km` : "Non renseigné"} />
        </dl>

        <div className="rounded-xl border border-[var(--border)] p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Motif</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{reservation.purpose}</p>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-3">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Transport de matériel</p>
          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">{reservation.willTransport ? "Oui" : "Non"}</p>
          {reservation.willTransport && reservation.transportDetails ? (
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted-foreground)]">{reservation.transportDetails}</p>
          ) : null}
        </div>

        {reservation.decidedBy || reservation.decisionNote ? (
          <div className="rounded-xl bg-[var(--accent)] p-3 text-sm text-[var(--muted-foreground)]">
            {reservation.decidedBy ? <p>Décision par {reservation.decidedBy}{reservation.decidedAt ? ` · ${formatDateTime(reservation.decidedAt)}` : ""}</p> : null}
            {reservation.decisionNote ? <p className="mt-1">{reservation.decisionNote}</p> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
          <Button variant="outline" onClick={() => onCancel(reservation._id)}><Trash2 className="h-4 w-4" />Annuler</Button>
          {canManage && reservation.status === "pending" ? (
            <>
              <Button variant="outline" onClick={() => decide("rejected")} disabled={saving !== null}><X className="h-4 w-4" />{saving === "rejected" ? "Refus..." : "Refuser"}</Button>
              <Button onClick={() => decide("approved")} disabled={saving !== null}><Check className="h-4 w-4" />{saving === "approved" ? "Approbation..." : "Approuver"}</Button>
            </>
          ) : null}
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

function StatusBadge({ status }: { status: ReservationItem["status"] }) {
  const styles = { approved: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200", pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", rejected: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200" };
  const labels = { approved: "Approuvée", pending: "En attente", rejected: "Refusée" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const map = { low: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200", medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", high: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200" };
  const label = { low: "Basse", medium: "Moyenne", high: "Haute" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[priority]}`}>{label[priority]}</span>;
}
