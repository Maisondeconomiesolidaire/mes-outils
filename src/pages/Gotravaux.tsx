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
  Upload,
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
  const vehicles = useQuery(api.gotravaux.listVehicles) as Vehicle[] | undefined;
  const tasks = useQuery(api.gotravaux.listVehicleTasks, {}) as VehicleTask[] | undefined;
  const updateTask = useMutation(api.gotravaux.updateVehicleTask);

  const [searchParams] = useSearchParams();
  const sub = searchParams.get("v") ?? "vehicles";
  const [search, setSearch] = useState("");
  const [statusTab, setStatusTab] = useState<"all" | "active" | "immobilized" | "sold">("all");

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
    sub === "vehicles" ? (
      <Button size="lg" onClick={() => setCreateOpen(true)}><Plus className="h-5 w-5" />Ajouter un véhicule</Button>
    ) : sub === "tasks" ? (
      <Button size="lg" onClick={() => setTaskModalOpen(true)}><Plus className="h-5 w-5" />Nouvelle maintenance</Button>
    ) : undefined;

  return (
    <>
      <div className="space-y-6">
        <SectionHeader title="Gotravaux" subtitle="Suivi complet de la flotte" actions={actions} />

        {sub === "vehicles" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
                {([{ key: "all", label: "Tous" }, { key: "active", label: "Actifs" }, { key: "immobilized", label: "Immobilisés" }, { key: "sold", label: "Vendus" }] as const).map((option) => (
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

        {sub === "tasks" ? <TaskList tasks={tasks} onUpdate={updateTask} /> : null}
        {sub === "reservations" && canSeeReservations ? <VehicleReservationsPanel /> : null}
        {sub === "calendar" ? <FleetCalendar vehicles={vehicles} tasks={tasks} canSeeReservations={canSeeReservations} /> : null}
      </div>

      {/* Création d'un véhicule (Informations seulement) */}
      <CreateVehicleModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Détails d'un véhicule existant : 3 onglets */}
      {detailsVehicle ? (
        <VehicleDetailsModal vehicle={detailsVehicle} onClose={() => setDetailsVehicleId(null)} />
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

function VehicleInfoForm({ vehicle, onSaved }: { vehicle: Vehicle | null; onSaved: () => void }) {
  const createVehicle = useMutation(api.gotravaux.createVehicle);
  const updateVehicle = useMutation(api.gotravaux.updateVehicle);
  const [form, setForm] = useState(() =>
    vehicle
      ? {
          name: vehicle.name, plate: vehicle.plate ?? "", kind: vehicle.kind, site: vehicle.site ?? "",
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

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name, plate: form.plate || undefined, kind: form.kind,
        site: (form.site || undefined) as "60" | "76" | undefined,
        brand: form.brand || undefined, model: form.model || undefined, seats: form.seats ? Number(form.seats) : undefined,
        assignedTo: form.assignedTo || undefined, photo: form.photo ?? undefined, photoUrl: form.photoUrl || undefined,
        odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined,
        technicalControlDate: form.technicalControlDate || undefined, pollutionControlDate: form.pollutionControlDate || undefined,
        active: form.status === "active",
        recycappEnabled: form.recycappEnabled,
      };
      const saleDate = form.status === "sold" ? (vehicle?.saleDate || new Date().toISOString().slice(0, 10)) : undefined;
      if (vehicle) await updateVehicle({ vehicleId: vehicle._id, ...payload, saleDate });
      else await createVehicle(payload);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <SinglePhotoUpload value={form.photo} previewUrl={form.photoUrl || null} onChange={(id) => setForm({ ...form, photo: id })} />
      <Field label="Nom" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Marque"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
        <Field label="Modèle"><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plaque"><Input value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value })} /></Field>
        <Field label="Type">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as VehicleKind })}>
            <option value="utilitaire">Utilitaire</option><option value="camionnette">Camionnette</option><option value="camion">Camion</option><option value="voiture">Voiture</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Site">
          <Select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value as "" | "60" | "76" })}>
            <option value="">Non renseigné</option><option value="60">Site 60</option><option value="76">Site 76</option>
          </Select>
        </Field>
        <Field label="Places"><Input type="number" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Kilométrage"><Input type="number" value={form.odometerKm} onChange={(e) => setForm({ ...form, odometerKm: e.target.value })} /></Field>
        <Field label="Attribué à"><Input value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contrôle technique"><DatePicker value={form.technicalControlDate} onChange={(value) => setForm({ ...form, technicalControlDate: value })} /></Field>
        <Field label="Contrôle pollution"><DatePicker value={form.pollutionControlDate} onChange={(value) => setForm({ ...form, pollutionControlDate: value })} /></Field>
      </div>
      <Field label="Statut">
        <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as VehicleStatus })}>
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
            onChange={(e) => setForm({ ...form, recycappEnabled: e.target.checked })}
            className="mt-1 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="block text-sm font-semibold text-[var(--foreground)]">
              Visible dans Recycapp
            </span>
            <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
              Si activé, ce véhicule apparaît dans la flotte et les affectations Recycapp.
            </span>
          </span>
        </span>
      </label>
      <div className="flex justify-end border-t border-[var(--border)] pt-4">
        <Button size="lg" onClick={save} disabled={saving || !form.name.trim()}>{saving ? "Enregistrement..." : "Enregistrer"}</Button>
      </div>
    </div>
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

function VehicleDetailsModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const [tab, setTab] = useState<"info" | "maintenance" | "documents">("info");
  const tabs = [
    { key: "info" as const, label: "Informations", icon: Info },
    { key: "maintenance" as const, label: "Maintenances", icon: Wrench },
    { key: "documents" as const, label: "Documents", icon: FileText },
  ];

  return (
    <Modal open onClose={onClose} title={vehicle.name} className="max-w-4xl">
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

      {tab === "info" ? <VehicleInfoForm vehicle={vehicle} onSaved={onClose} /> : null}
      {tab === "maintenance" ? <VehicleMaintenanceTab vehicleId={vehicle._id} /> : null}
      {tab === "documents" ? <VehicleDocumentsTab vehicleId={vehicle._id} /> : null}
    </Modal>
  );
}

function VehicleMaintenanceTab({ vehicleId }: { vehicleId: Id<"vehicles"> }) {
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
      ) : (
        <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Nouvelle maintenance</Button>
      )}

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
                <Select value={task.status} onChange={(e) => updateTask({ taskId: task._id, status: e.target.value as TaskStatus, priority: task.priority })} className="h-9 w-auto">
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

function VehicleDocumentsTab({ vehicleId }: { vehicleId: Id<"vehicles"> }) {
  const documents = useQuery(api.gotravaux.listVehicleDocuments, { vehicleId });
  const addDocument = useMutation(api.gotravaux.addVehicleDocument);
  const removeDocument = useMutation(api.gotravaux.removeVehicleDocument);
  const upload = useUpload();
  const [category, setCategory] = useState<DocCategory>("carte_grise");
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const storageId = await upload(file);
      await addDocument({ vehicleId, name: file.name, category, storageId });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--accent)] p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="Catégorie">
          <Select value={category} onChange={(e) => setCategory(e.target.value as DocCategory)}>
            {DOC_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </Select>
        </Field>
        <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition hover:bg-brand-600">
          <Upload className="h-4 w-4" />
          {uploading ? "Import..." : "Importer"}
          <input type="file" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} disabled={uploading} />
        </label>
      </div>

      {documents === undefined ? (
        <FullSpinner label="Chargement..." />
      ) : documents.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">Aucun document. Importez carte grise, factures, devis...</p>
      ) : (
        <div className="space-y-2">
          {documents.map((document) => (
            <div key={document._id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3">
              <FileText className="h-5 w-5 shrink-0 text-brand-600" />
              <a href={document.url ?? "#"} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)] hover:underline">{document.name}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{DOC_CATEGORIES.find((c) => c.key === document.category)?.label} · {document.uploadedBy}</p>
              </a>
              <button type="button" onClick={() => removeDocument({ documentId: document._id })} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
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
    <Modal open={open} onClose={onClose} title="Nouvelle maintenance" className="max-w-4xl">
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

function TaskList({ tasks, onUpdate }: { tasks: VehicleTask[]; onUpdate: ReturnType<typeof useMutation> }) {
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
            <Select value={task.status} onChange={(e) => onUpdate({ taskId: task._id, status: e.target.value as TaskStatus, priority: task.priority })}>
              <option value="todo">À faire</option><option value="in_progress">En cours</option><option value="done">Terminée</option>
            </Select>
          </div>
        ))}
      </div>
    </section>
  );
}

type AgendaEntry = { date: number; label: string; sublabel: string; tone: "reservation" | "maintenance" | "pending" };

function FleetCalendar({ vehicles, tasks, canSeeReservations }: { vehicles: Vehicle[]; tasks: VehicleTask[]; canSeeReservations: boolean }) {
  const reservations = useQuery(api.reservations.listVehicleReservations, canSeeReservations ? {} : "skip");
  const entries: AgendaEntry[] = [];
  const vehicleName = new Map(vehicles.map((v) => [String(v._id), v.name]));

  for (const task of tasks) {
    if (task.status === "done" || !task.dueDate) continue;
    entries.push({ date: task.dueDate, label: `Maintenance · ${task.vehicle?.name ?? vehicleName.get(String(task.vehicleId)) ?? "Véhicule"}`, sublabel: task.title, tone: "maintenance" });
  }
  for (const reservation of reservations ?? []) {
    if (reservation.status === "rejected") continue;
    entries.push({ date: reservation.start, label: `${reservation.vehicle?.name ?? "Véhicule"} · ${reservation.userName}`, sublabel: reservation.purpose, tone: reservation.status === "approved" ? "reservation" : "pending" });
  }

  const upcoming = entries.filter((entry) => entry.date > Date.now() - 86_400_000).sort((a, b) => a.date - b.date);
  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of upcoming) {
    const key = formatDate(entry.date);
    byDay.set(key, [...(byDay.get(key) ?? []), entry]);
  }

  if (upcoming.length === 0) return <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Agenda vide" description="Réservations et maintenances à venir s'afficheront ici." />;

  const toneStyles = { reservation: "border-l-brand-500", maintenance: "border-l-amber-500", pending: "border-l-sky-500" };

  return (
    <div className="space-y-5">
      {Array.from(byDay.entries()).map(([day, dayEntries]) => (
        <section key={day} className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--border)] bg-[var(--accent)] px-5 py-2.5"><p className="text-sm font-bold capitalize text-[var(--foreground)]">{day}</p></div>
          <div className="divide-y divide-[var(--border)]">
            {dayEntries.map((entry, index) => (
              <div key={index} className={`flex items-center gap-4 border-l-4 px-5 py-3 ${toneStyles[entry.tone]}`}>
                <span className="w-14 shrink-0 text-sm font-semibold text-[var(--foreground)]">{formatDateTime(entry.date).slice(-5)}</span>
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--foreground)]">{entry.label}</p><p className="truncate text-xs text-[var(--muted-foreground)]">{entry.sublabel}</p></div>
                {entry.tone === "pending" ? <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">En attente</span> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function VehicleReservationsPanel() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:reservations", "manage");
  const reservations = useQuery(api.reservations.listVehicleReservations, {});
  const decide = useMutation(api.reservations.decideVehicleReservation);
  const cancel = useMutation(api.reservations.cancelVehicleReservation);

  if (reservations === undefined) return <FullSpinner label="Chargement des réservations..." />;
  if (reservations.length === 0) return <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="Aucune réservation" description="Les demandes de réservation apparaîtront ici." />;

  const pending = reservations.filter((r) => r.status === "pending");
  const others = reservations.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-6">
      {pending.length > 0 ? (
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-lg font-semibold text-[var(--foreground)]">À traiter ({pending.length})</h2></div>
          <div className="divide-y divide-[var(--border)]">
            {pending.map((r) => (
              <ReservationRow key={r._id} reservation={r} canManage={canManage} onApprove={() => decide({ reservationId: r._id, decision: "approved" })} onReject={() => decide({ reservationId: r._id, decision: "rejected" })} onCancel={() => cancel({ reservationId: r._id })} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-lg font-semibold text-[var(--foreground)]">Historique</h2></div>
        <div className="divide-y divide-[var(--border)]">
          {others.map((r) => <ReservationRow key={r._id} reservation={r} canManage={canManage} onCancel={() => cancel({ reservationId: r._id })} />)}
        </div>
      </section>
    </div>
  );
}

type ReservationItem = {
  _id: Id<"vehicleReservations">;
  vehicle?: { name?: string } | null;
  vehiclePhotoUrl?: string | null;
  userName: string;
  bookedByName?: string;
  purpose: string;
  start: number;
  end: number;
  status: "pending" | "approved" | "rejected";
};

function ReservationRow({ reservation, canManage, onApprove, onReject, onCancel }: { reservation: ReservationItem; canManage: boolean; onApprove?: () => void; onReject?: () => void; onCancel: () => void }) {
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
        {canManage && reservation.status === "pending" && onApprove && onReject ? (
          <>
            <Button size="sm" onClick={onApprove}><Check className="h-4 w-4" />Approuver</Button>
            <Button variant="outline" size="sm" onClick={onReject}><X className="h-4 w-4" />Refuser</Button>
          </>
        ) : null}
        <button type="button" onClick={onCancel} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600" title="Annuler"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: ReservationItem["status"] }) {
  const styles = { approved: "bg-brand-100 text-brand-800", pending: "bg-amber-100 text-amber-800", rejected: "bg-rose-100 text-rose-800" };
  const labels = { approved: "Approuvée", pending: "En attente", rejected: "Refusée" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const map = { low: "bg-zinc-200 text-zinc-700", medium: "bg-amber-100 text-amber-800", high: "bg-rose-100 text-rose-800" };
  const label = { low: "Basse", medium: "Moyenne", high: "Haute" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[priority]}`}>{label[priority]}</span>;
}
