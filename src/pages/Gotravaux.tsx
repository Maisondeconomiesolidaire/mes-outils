import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarClock,
  CalendarDays,
  CarFront,
  Check,
  Clock,
  Euro,
  FileText,
  Info,
  MapPin,
  MessageSquareText,
  Plus,
  Route,
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
import { MediaUpload } from "../components/ui/MediaUpload";
import { SinglePhotoUpload } from "../components/ui/SinglePhotoUpload";
import { VehicleSearchSelect } from "../components/ui/VehicleSearchSelect";
import { DatePicker } from "../components/ui/DatePicker";
import { FullSpinner } from "../components/ui/Spinner";
import { useUpload } from "../lib/useUpload";
import { formatDate, formatDateTime, formatDateTimeWithDay, relativeUnits } from "../lib/format";
import { canAccess } from "../lib/permissions";
import { cn } from "../lib/cn";
import { CalendarBoard, type CalendarEvent } from "../components/ui/CalendarBoard";
import { ReservationRemarks } from "../components/ReservationRemarks";
import { SectionTabs } from "../components/ui/SectionTabs";
import { UnderlineTabs } from "../components/ui/UnderlineTabs";
import { confirmPermanentDelete } from "../lib/confirm";

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
  reservablePro?: boolean;
  reservablePersonal?: boolean;
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
  odometerKm?: number;
  laborMinutes?: number;
  partsCost?: number;
  attachments?: Id<"_storage">[];
  /** URLs signées, résolues par `listVehicleTasks` (les storageId seuls ne s'affichent pas). */
  attachmentUrls?: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

type ServiceType = "aerogommage" | "collecte" | "article" | "velo" | "livraison";

type ServiceItem = {
  _id: Id<"requests">;
  type: ServiceType;
  collecteType?: string | null;
  reference?: string | null;
  scheduledDate: number;
  vehicleId: Id<"vehicles">;
  vehicleName?: string | null;
  vehiclePlate?: string | null;
  vehiclePhotoUrl?: string | null;
  customerName: string;
  scheduledByName?: string | null;
  address?: string | null;
  postalCode?: string | null;
  city?: string | null;
  storedDistanceKm?: number | null;
};

const SERVICE_LABELS: Record<ServiceType, string> = {
  collecte: "Collecte",
  livraison: "Livraison",
  aerogommage: "Aérogommage",
  article: "Article",
  velo: "Vélo",
};

function serviceAddressString(service: ServiceItem) {
  return [service.address, service.postalCode, service.city].filter(Boolean).join(" ");
}

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
                  <article key={vehicle._id} onClick={() => setDetailsVehicleId(vehicle._id)} className="group cursor-pointer overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:shadow-md">
                    <div className="relative aspect-video overflow-hidden bg-[var(--muted)]">
                      {vehicle.photoUrl ? (
                        <img src={vehicle.photoUrl} alt={vehicle.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
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
                    </div>
                  </article>
                ))}
              </section>
            )}
          </div>
        ) : null}

        {sub === "tasks" ? <TaskList tasks={tasks} onUpdate={updateTask} canEdit={canEdit} /> : null}
        {sub === "reservations" && canSeeReservations ? <VehicleReservationsPanel /> : null}
        {sub === "remarques" ? <ReservationRemarks kind="vehicle" /> : null}
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
  recycappEnabled: false, reservablePro: true, reservablePersonal: false,
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
          reservablePro: vehicle.reservablePro !== false,
          reservablePersonal: vehicle.reservablePersonal === true,
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
      reservablePro: nextForm.reservablePro,
      reservablePersonal: nextForm.reservablePersonal,
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
      <div className="grid gap-3">
        <p className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Réservation</p>
        <label className="rounded-xl border border-[var(--border)] bg-[var(--accent)] p-4">
          <span className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.reservablePro}
              onChange={(e) => updateForm({ reservablePro: e.target.checked })}
              className="mt-1 h-4 w-4 accent-brand-500"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--foreground)]">
                Réservable pour un usage professionnel
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                Autorise la réservation de ce véhicule pour les déplacements professionnels.
              </span>
            </span>
          </span>
        </label>
        <label className="rounded-xl border border-[var(--border)] bg-[var(--accent)] p-4">
          <span className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.reservablePersonal}
              onChange={(e) => updateForm({ reservablePersonal: e.target.checked })}
              className="mt-1 h-4 w-4 accent-brand-500"
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--foreground)]">
                Réservable pour un usage personnel
              </span>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted-foreground)]">
                Autorise la réservation de ce véhicule pour les déplacements personnels.
              </span>
            </span>
          </span>
        </label>
      </div>

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

/* ─── Modal détails véhicule (4 onglets) ─────────────────────────────────── */

function VehicleDetailsModal({ vehicle, onClose, canCreate, canEdit }: { vehicle: Vehicle; onClose: () => void; canCreate: boolean; canEdit: boolean }) {
  const [tab, setTab] = useState<"info" | "maintenance" | "documents" | "remarques">("info");
  const tabs = [
    { key: "info" as const, label: "Informations", icon: Info },
    { key: "maintenance" as const, label: "Maintenances", icon: Wrench },
    { key: "documents" as const, label: "Documents", icon: FileText },
    { key: "remarques" as const, label: "Remarques", icon: MessageSquareText },
  ];

  return (
    <Modal open onClose={onClose} title={vehicle.name}>
      <div className="mb-4 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--accent)] p-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold transition sm:gap-2 sm:px-3 sm:text-sm ${tab === item.key ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}>
              <Icon className="h-4 w-4 shrink-0" /><span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>

      {tab === "info" ? <VehicleInfoForm vehicle={vehicle} onSaved={onClose} canSave={canEdit} /> : null}
      {tab === "maintenance" ? <VehicleMaintenanceTab vehicleId={vehicle._id} canCreate={canCreate} canEdit={canEdit} /> : null}
      {tab === "documents" ? <VehicleDocumentsTab vehicleId={vehicle._id} canEdit={canEdit} /> : null}
      {tab === "remarques" ? <ReservationRemarks kind="vehicle" vehicleId={vehicle._id} /> : null}
    </Modal>
  );
}

function VehicleMaintenanceTab({ vehicleId, canCreate, canEdit }: { vehicleId: Id<"vehicles">; canCreate: boolean; canEdit: boolean }) {
  const tasks = useQuery(api.gotravaux.listVehicleTasks, { vehicleId }) as VehicleTask[] | undefined;
  const createTask = useMutation(api.gotravaux.createVehicleTask);
  const updateTask = useMutation(api.gotravaux.updateVehicleTask);
  const [adding, setAdding] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"vehicleMaintenanceTasks"> | null>(null);
  const [closingTaskId, setClosingTaskId] = useState<Id<"vehicleMaintenanceTasks"> | null>(null);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [odometerKm, setOdometerKm] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [laborMins, setLaborMins] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!title.trim()) return;
    const laborMinutesValue =
      laborHours.trim() || laborMins.trim()
        ? (Number(laborHours) || 0) * 60 + (Number(laborMins) || 0)
        : undefined;
    setSaving(true);
    try {
      await createTask({
        vehicleId,
        title,
        priority,
        dueDate: range.start ?? undefined,
        endDate: range.end ?? undefined,
        odometerKm: odometerKm ? Number(odometerKm) : undefined,
        laborMinutes: laborMinutesValue,
        partsCost: partsCost.trim() ? Number(partsCost) : undefined,
      });
      setTitle("");
      setPriority("medium");
      setRange({ start: null, end: null });
      setOdometerKm("");
      setLaborHours("");
      setLaborMins("");
      setPartsCost("");
      setAdding(false);
    } finally {
      setSaving(false);
    }
  }

  const selectedTask = tasks?.find((task) => task._id === selectedTaskId) ?? null;

  return (
    <>
      <div className="space-y-4">
      {adding ? (
        <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--accent)] p-4">
          <Field label="Intitulé" required><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Vidange, pneu, contrôle..." /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Période"><DateRangePicker value={range} onChange={setRange} placeholder="Période de maintenance" /></Field>
            <Field label="Priorité">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}><option value="low">Basse</option><option value="medium">Moyenne</option><option value="high">Haute</option></Select>
            </Field>
            <Field label="Kilométrage">
              <Input type="number" inputMode="numeric" value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} placeholder="Ex: 125000" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Temps passé" hint="Requis pour clôturer">
              <div className="flex items-center gap-2">
                <Input type="number" inputMode="numeric" min="0" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} placeholder="h" />
                <span className="text-sm text-[var(--muted-foreground)]">h</span>
                <Input type="number" inputMode="numeric" min="0" max="59" value={laborMins} onChange={(e) => setLaborMins(e.target.value)} placeholder="min" />
                <span className="text-sm text-[var(--muted-foreground)]">min</span>
              </div>
            </Field>
            <Field label="Prix des pièces (€)" hint="Requis pour clôturer">
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} placeholder="Ex: 45,00" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Annuler</Button>
            <Button size="sm" onClick={add} disabled={saving || !title.trim()}>{saving ? "Ajout..." : "Ajouter"}</Button>
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
        <TaskKanban
          tasks={tasks}
          onOpenTask={setSelectedTaskId}
        />
      )}
      </div>
      <MaintenanceDetailsModal
        task={selectedTask}
        canEdit={canEdit}
        initialEditing={selectedTaskId !== null && selectedTaskId === closingTaskId}
        onClose={() => {
          setSelectedTaskId(null);
          setClosingTaskId(null);
        }}
        onUpdate={updateTask}
      />
    </>
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

  async function removeDocumentWithConfirmation(documentId: Id<"vehicleDocuments">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement ce document ?"))) return;
    void removeDocument({ documentId });
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
                {canEdit ? <button type="button" onClick={() => removeDocumentWithConfirmation(document._id)} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button> : null}
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
  const [odometerKm, setOdometerKm] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [laborMins, setLaborMins] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [attachments, setAttachments] = useState<Id<"_storage">[]>([]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vehicleId || !title.trim()) return;
    const laborMinutesValue =
      laborHours.trim() || laborMins.trim()
        ? (Number(laborHours) || 0) * 60 + (Number(laborMins) || 0)
        : undefined;
    setSaving(true);
    try {
      await createTask({
        vehicleId,
        title,
        description: description || undefined,
        priority,
        dueDate: range.start ?? undefined,
        endDate: range.end ?? undefined,
        odometerKm: odometerKm ? Number(odometerKm) : undefined,
        laborMinutes: laborMinutesValue,
        partsCost: partsCost.trim() ? Number(partsCost) : undefined,
        attachments: attachments.length ? attachments : undefined,
      });
      setVehicleId(""); setTitle(""); setDescription(""); setPriority("medium"); setRange({ start: null, end: null }); setOdometerKm(""); setLaborHours(""); setLaborMins(""); setPartsCost(""); setAttachments([]);
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
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Période"><DateRangePicker value={range} onChange={setRange} placeholder="Période de maintenance" /></Field>
          <Field label="Priorité">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}><option value="low">Basse</option><option value="medium">Moyenne</option><option value="high">Haute</option></Select>
          </Field>
          <Field label="Kilométrage">
            <Input type="number" inputMode="numeric" value={odometerKm} onChange={(e) => setOdometerKm(e.target.value)} placeholder="Ex: 125000" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Temps passé" hint="Requis pour clôturer">
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="numeric" min="0" value={laborHours} onChange={(e) => setLaborHours(e.target.value)} placeholder="h" />
              <span className="text-sm text-[var(--muted-foreground)]">h</span>
              <Input type="number" inputMode="numeric" min="0" max="59" value={laborMins} onChange={(e) => setLaborMins(e.target.value)} placeholder="min" />
              <span className="text-sm text-[var(--muted-foreground)]">min</span>
            </div>
          </Field>
          <Field label="Prix des pièces (€)" hint="Requis pour clôturer">
            <Input type="number" inputMode="decimal" min="0" step="0.01" value={partsCost} onChange={(e) => setPartsCost(e.target.value)} placeholder="Ex: 45,00" />
          </Field>
        </div>
        <Field label="Photos">
          <MediaUpload images={attachments} onChange={setAttachments} />
        </Field>
        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button variant="ghost" onClick={onClose}>Annuler</Button>
          <Button onClick={save} disabled={saving || !vehicleId || !title.trim()}>{saving ? "Ajout..." : "Ajouter"}</Button>
        </div>
      </div>
    </Modal>
  );
}

const TASK_STATUS_COLUMNS = [
  {
    key: "todo" as const,
    label: "A faire",
    tone: "border-amber-400 bg-amber-50/70 dark:bg-amber-500/10",
  },
  {
    key: "in_progress" as const,
    label: "En cours",
    tone: "border-sky-400 bg-sky-50/70 dark:bg-sky-500/10",
  },
  {
    key: "done" as const,
    label: "Terminée",
    tone: "border-emerald-400 bg-emerald-50/70 dark:bg-emerald-500/10",
  },
] satisfies Array<{
  key: TaskStatus;
  label: string;
  tone: string;
}>;

/** « a, b et c » — énumération lisible dans les messages de blocage. */
function formatList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

const MAINTENANCE_STEPS: Array<{ status: TaskStatus; label: string }> = [
  { status: "todo", label: "À faire" },
  { status: "in_progress", label: "En cours" },
  { status: "done", label: "Terminée" },
];

/**
 * Avancement d'une maintenance, sur le modèle du process CRM de recycapp :
 * étapes ordonnées, une seule cliquable à la fois (l'étape suivante pour
 * avancer, la dernière franchie pour revenir en arrière), et blocage explicite
 * quand des informations manquent.
 *
 * Le blocage n'est pas qu'un confort d'interface : le serveur refuse déjà de
 * clôturer sans temps passé ni prix des pièces (`ensureClosingCost`). Ici on
 * dit *pourquoi* c'est bloqué, avant le clic, au lieu de laisser remonter une
 * erreur après coup.
 */
function MaintenanceSteps({
  task,
  canEdit,
  onChangeStatus,
  onFixMissing,
}: {
  task: VehicleTask;
  canEdit: boolean;
  onChangeStatus: (status: TaskStatus) => void;
  /** Ouvre l'édition pour saisir ce qui manque à la clôture. */
  onFixMissing: () => void;
}) {
  const currentIndex = MAINTENANCE_STEPS.findIndex((step) => step.status === task.status);
  const missing = missingClosingFields(task);
  const blockers: Partial<Record<TaskStatus, string>> = {};
  if (missing.length > 0) {
    blockers.done = `Renseignez ${formatList(missing)} avant de terminer.`;
  }
  const completionPercent = Math.round(((currentIndex + 1) / MAINTENANCE_STEPS.length) * 100);

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--accent)] p-3">
        <div className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
          <span>Avancement</span>
          <span className="text-brand-600">{completionPercent}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-[var(--card)]">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
      </div>

      <ol className="grid gap-2 sm:grid-cols-3">
        {MAINTENANCE_STEPS.map((step, index) => {
          const isDone = index <= currentIndex;
          const isNext = index === currentIndex + 1;
          const isLastDone = index === currentIndex && index > 0;
          const blocker = blockers[step.status];
          const actionable = canEdit && (isNext || isLastDone);

          return (
            <li key={step.status}>
              <button
                type="button"
                disabled={!actionable}
                onClick={() => {
                  if (isNext && blocker) {
                    onFixMissing();
                    return;
                  }
                  onChangeStatus(isLastDone ? MAINTENANCE_STEPS[index - 1].status : step.status);
                }}
                className={cn(
                  "flex min-h-[112px] w-full flex-col items-center justify-between rounded-2xl border px-3 py-3 text-center transition",
                  isDone
                    ? "border-brand-500/40 bg-brand-50 text-[var(--foreground)] dark:bg-brand-500/10"
                    : isNext && blocker
                      ? "border-amber-400 bg-amber-50/60 text-[var(--foreground)] dark:bg-amber-500/10"
                      : isNext
                        ? "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-brand-500"
                        : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)]",
                  actionable ? "cursor-pointer" : "cursor-not-allowed",
                )}
                title={isNext && blocker ? blocker : undefined}
              >
                <span
                  className={cn(
                    "mb-2 flex h-8 w-8 items-center justify-center rounded-full border-2 transition",
                    isDone
                      ? "border-brand-500 bg-brand-500 text-white"
                      : isNext
                        ? "border-brand-400 text-brand-600"
                        : "border-[var(--border)] text-transparent",
                  )}
                >
                  {isDone ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
                </span>
                <span className="flex-1 text-sm font-semibold leading-5">{step.label}</span>
                {isNext && canEdit ? (
                  <span
                    className={cn(
                      "mt-2 text-[11px] font-bold uppercase tracking-[0.12em]",
                      blocker ? "text-amber-600 dark:text-amber-400" : "text-brand-600",
                    )}
                  >
                    {blocker ? "Infos requises" : "Prochaine étape"}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      {canEdit && currentIndex + 1 < MAINTENANCE_STEPS.length
        ? (() => {
            const nextStep = MAINTENANCE_STEPS[currentIndex + 1];
            const blocker = blockers[nextStep.status];
            return blocker ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                {blocker}
              </p>
            ) : null;
          })()
        : null}
    </div>
  );
}

function TaskList({ tasks, onUpdate, canEdit }: { tasks: VehicleTask[]; onUpdate: ReturnType<typeof useMutation>; canEdit: boolean }) {
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"vehicleMaintenanceTasks"> | null>(null);
  const [closingTaskId, setClosingTaskId] = useState<Id<"vehicleMaintenanceTasks"> | null>(null);
  if (tasks.length === 0) return <EmptyState icon={<Wrench className="h-8 w-8" />} title="Aucune maintenance" description="Les maintenances apparaîtront ici." />;
  const selectedTask = tasks.find((task) => task._id === selectedTaskId) ?? null;
  return (
    <>
      <TaskKanban
        tasks={tasks}
        onOpenTask={setSelectedTaskId}
      />
      <MaintenanceDetailsModal
        task={selectedTask}
        canEdit={canEdit}
        initialEditing={selectedTaskId !== null && selectedTaskId === closingTaskId}
        onClose={() => {
          setSelectedTaskId(null);
          setClosingTaskId(null);
        }}
        onUpdate={onUpdate}
      />
    </>
  );
}

/**
 * Vue kanban en lecture : les cartes ouvrent la fiche, l'avancement se fait
 * dans la modale (étapes), comme dans le CRM recycapp.
 */
function TaskKanban({
  tasks,
  onOpenTask,
}: {
  tasks: VehicleTask[];
  onOpenTask: (taskId: Id<"vehicleMaintenanceTasks">) => void;
}) {
  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, VehicleTask[]> = {
      todo: [],
      in_progress: [],
      done: [],
    };
    for (const task of tasks) {
      grouped[task.status].push(task);
    }
    for (const status of Object.keys(grouped) as TaskStatus[]) {
      grouped[status].sort((a, b) => {
        const aDate = a.dueDate ?? a.createdAt;
        const bDate = b.dueDate ?? b.createdAt;
        return aDate - bDate;
      });
    }
    return grouped;
  }, [tasks]);

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      {TASK_STATUS_COLUMNS.map((column) => {
        const columnTasks = tasksByStatus[column.key];
        return (
          <div
            key={column.key}
            className={cn(
              "flex min-h-[26rem] flex-col rounded-2xl border p-4",
              column.tone,
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[var(--foreground)]">{column.label}</h3>
              </div>
              <span className="rounded-full bg-[var(--card)] px-2.5 py-1 text-xs font-bold text-[var(--foreground)]">
                {columnTasks.length}
              </span>
            </div>

            <div className="mt-4 flex-1 space-y-3">
              {columnTasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--card)]/50 px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Aucune maintenance
                </div>
              ) : (
                columnTasks.map((task) => (
                  <article
                    key={task._id}
                    onClick={() => onOpenTask(task._id)}
                    className="cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-sm transition hover:border-brand-400"
                  >
                    <div className="flex items-start gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--muted)]">
                        {task.vehicle?.photoUrl ? (
                          <img
                            src={task.vehicle.photoUrl}
                            alt={task.vehicle.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--muted-foreground)]">
                            <CarFront className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[var(--foreground)]">{task.title}</p>
                          <PriorityBadge priority={task.priority} />
                        </div>
                        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                          {task.vehicle?.name ?? "Véhicule"} · créé par {task.createdBy}
                        </p>
                        {task.description ? (
                          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
                            {task.description}
                          </p>
                        ) : null}
                        <div className="mt-3 flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                          <CalendarClock className="h-4 w-4" />
                          {task.dueDate ? formatDate(task.dueDate) : "Sans date"}
                          {task.endDate && task.endDate !== task.dueDate
                            ? ` → ${formatDate(task.endDate)}`
                            : ""}
                        </div>
                        {task.odometerKm !== undefined ? (
                          <div className="mt-2 text-sm text-[var(--muted-foreground)]">
                            Kilométrage: <span className="font-semibold text-[var(--foreground)]">{task.odometerKm.toLocaleString("fr-FR")} km</span>
                          </div>
                        ) : null}
                        <MaintenanceCostBadges task={task} className="mt-2" />
                      </div>
                    </div>

                    <div className="mt-4 space-y-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenTask(task._id);
                        }}
                      >
                        <Info className="h-4 w-4" />Détails
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        );
      })}
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
    }
  | {
      id: string;
      kind: "service";
      service: ServiceItem;
      date: number;
      endDate?: number;
      label: string;
      sublabel: string;
      tone: "service";
    }
  | {
      id: string;
      kind: "control";
      vehicle: Vehicle;
      date: number;
      endDate?: number;
      label: string;
      sublabel: string;
      tone: "control";
    };

type AgendaKind = AgendaEntry["kind"];

/** Filtres du calendrier flotte : chaque puce fait aussi office de légende. */
const AGENDA_FILTERS: Array<{ key: AgendaKind; label: string; dot: string }> = [
  { key: "task", label: "Maintenances", dot: "bg-amber-500" },
  { key: "reservation", label: "Réservations", dot: "bg-brand-500" },
  { key: "service", label: "Prestations", dot: "bg-violet-500" },
  { key: "control", label: "Contrôles", dot: "bg-rose-500" },
];

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
  const canDeleteForever = access?.email?.trim().toLowerCase() === "lahmerselim@gmail.com";
  const reservations = useQuery(api.reservations.listVehicleReservations, canSeeReservations ? {} : "skip") as ReservationItem[] | undefined;
  const services = useQuery(api.gotravaux.listScheduledServices, {}) as ServiceItem[] | undefined;
  const decide = useMutation(api.reservations.decideVehicleReservation);
  const cancel = useMutation(api.reservations.cancelVehicleReservation);
  const [selectedDay, setSelectedDay] = useState(() => startOfDayTimestamp(Date.now()));
  const [dayPanelOpen, setDayPanelOpen] = useState(false);
  const [selectedReservationId, setSelectedReservationId] = useState<Id<"vehicleReservations"> | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<Id<"requests"> | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<Id<"vehicleMaintenanceTasks"> | null>(null);
  const [closingTaskId, setClosingTaskId] = useState<Id<"vehicleMaintenanceTasks"> | null>(null);
  const [kindFilter, setKindFilter] = useState<AgendaKind | "all">("all");
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
    if (reservation.status === "rejected" || reservation.status === "cancelled") continue;
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
  for (const service of services ?? []) {
    const serviceSublabel =
      service.type === "collecte"
        ? [service.scheduledByName ? `Planifié par ${service.scheduledByName}` : null, service.city].filter(Boolean).join(" · ")
        : [service.customerName, service.city].filter(Boolean).join(" · ");
    entries.push({
      id: `service-${service._id}`,
      kind: "service",
      service,
      date: service.scheduledDate,
      label: `${SERVICE_LABELS[service.type]} · ${service.vehicleName ?? vehicleName.get(String(service.vehicleId)) ?? "Véhicule"}`,
      sublabel: serviceSublabel,
      tone: "service",
    });
  }
  for (const vehicle of vehicles) {
    const controls = [
      { key: "technical", label: "Contrôle technique", date: vehicle.technicalControlDate },
      { key: "pollution", label: "Contrôle pollution", date: vehicle.pollutionControlDate },
    ] as const;
    for (const control of controls) {
      const date = dateStringToLocalTimestamp(control.date);
      if (!date) continue;
      entries.push({
        id: `control-${control.key}-${vehicle._id}`,
        kind: "control",
        vehicle,
        date,
        label: `${control.label} · ${vehicle.name}`,
        sublabel: [vehicle.plate, vehicle.brand, vehicle.model].filter(Boolean).join(" · "),
        tone: "control",
      });
    }
  }

  const toneStyles = {
    reservation: "border-l-brand-500",
    maintenance: "border-l-amber-500",
    pending: "border-l-sky-500",
    service: "border-l-violet-500",
    control: "border-l-rose-500",
  };
  const visibleEntries = entries.filter((entry) => kindFilter === "all" || entry.kind === kindFilter);
  const calendarEvents: CalendarEvent[] = visibleEntries.map((entry) => ({
    id: entry.id,
    start: entry.date,
    end: entry.endDate,
    title: entry.label,
    subtitle: entry.sublabel,
    tone:
      entry.tone === "maintenance"
        ? "amber"
        : entry.tone === "pending"
          ? "sky"
          : entry.tone === "service"
            ? "violet"
            : entry.tone === "control"
              ? "rose"
            : "brand",
  }));
  const selectedDayEntries = visibleEntries
    .filter((entry) => overlapsDay(entry.date, entry.endDate, selectedDay))
    .sort((a, b) => a.date - b.date);
  const selectedReservation = reservations?.find((reservation) => reservation._id === selectedReservationId) ?? null;
  const selectedService = services?.find((service) => service._id === selectedServiceId) ?? null;
  const selectedTask = tasks.find((task) => task._id === selectedTaskId) ?? null;

  async function decideAndClose(reservationId: Id<"vehicleReservations">, decision: "approved" | "rejected") {
    await decide({ reservationId, decision });
    setSelectedReservationId(null);
  }

  async function cancelReservationWithConfirmation(reservationId: Id<"vehicleReservations">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement cette réservation de véhicule ?"))) return;
    void cancel({ reservationId });
    setSelectedReservationId(null);
  }

  function openDayPanel(day: Date) {
    setSelectedDay(startOfDayTimestamp(day.getTime()));
    setDayPanelOpen(true);
  }

  function handleEventClick(id: string, day?: Date) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    setSelectedDay(startOfDayTimestamp((day ?? new Date(entry.date)).getTime()));
    if (entry.kind === "reservation") setSelectedReservationId(entry.reservation._id);
    else if (entry.kind === "service") setSelectedServiceId(entry.service._id);
    else if (entry.kind === "control") onOpenVehicle(entry.vehicle._id);
    else setSelectedTaskId(entry.task._id);
  }

  function openReservationDetailsFromPanel(reservationId: Id<"vehicleReservations">) {
    setDayPanelOpen(false);
    setSelectedReservationId(reservationId);
  }

  function openServiceDetailsFromPanel(serviceId: Id<"requests">) {
    setDayPanelOpen(false);
    setSelectedServiceId(serviceId);
  }

  function openTaskDetailsFromPanel(taskId: Id<"vehicleMaintenanceTasks">) {
    setDayPanelOpen(false);
    setSelectedTaskId(taskId);
  }

  return (
    <div className="space-y-5">
      {/* Même logique que tous les autres filtres de l'app : « Tous » par
          défaut, et cliquer un type n'affiche que celui-là. */}
      <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--card)] p-1">
        {[{ key: "all" as const, label: "Tous", dot: null }, ...AGENDA_FILTERS]
          .filter((filter) => filter.key !== "reservation" || canSeeReservations)
          .map((filter) => {
            const active = kindFilter === filter.key;
            const count =
              filter.key === "all"
                ? entries.length
                : entries.filter((entry) => entry.kind === filter.key).length;
            return (
              <button
                key={filter.key}
                type="button"
                onClick={() => setKindFilter(filter.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition",
                  active
                    ? "bg-brand-500 text-white"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                )}
              >
                {filter.dot ? (
                  <span className={cn("h-2.5 w-2.5 rounded-full", filter.dot, active && "bg-white")} />
                ) : null}
                {filter.label}
                <span className={active ? "text-white/75" : "text-[var(--muted-foreground)]"}>{count}</span>
              </button>
            );
          })}
      </div>
      <CalendarBoard
        events={calendarEvents}
        selected={selectedDay}
        onSelect={openDayPanel}
        onEventClick={handleEventClick}
      />
      <div className={`fixed inset-0 z-[70] transition ${dayPanelOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
        <button
          type="button"
          aria-label="Fermer les événements du jour"
          onClick={() => setDayPanelOpen(false)}
          className={`absolute inset-0 bg-black/30 transition-opacity ${dayPanelOpen ? "opacity-100" : "opacity-0"}`}
        />
        <aside
          className={`absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] shadow-2xl transition-transform duration-300 ease-out ${dayPanelOpen ? "translate-x-0" : "translate-x-full"}`}
        >
          <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Événements</p>
              <h2 className="mt-1 text-lg font-bold capitalize">{formatDate(selectedDay)}</h2>
            </div>
            <button type="button" onClick={() => setDayPanelOpen(false)} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {selectedDayEntries.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<CalendarDays className="h-8 w-8" />} title="Agenda vide" description="Aucune réservation, maintenance, prestation ou contrôle sur cette journée." />
              </div>
            ) : (
              <div className="divide-y divide-[var(--border)]">
                {selectedDayEntries.map((entry) => (
                  <div key={entry.id} className={`flex flex-wrap items-center gap-4 border-l-4 px-5 py-3 ${toneStyles[entry.tone]}`}>
                    <span className="w-14 shrink-0 text-sm font-semibold text-[var(--foreground)]">{formatDateTime(entry.date).slice(-5)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--foreground)]">{entry.label}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{entry.sublabel}</p>
                      {entry.endDate ? <p className="text-xs text-[var(--muted-foreground)]">{formatDateTime(entry.date)} → {formatDateTime(entry.endDate)}</p> : null}
                      {entry.kind === "task" ? <MaintenanceCostBadges task={entry.task} className="mt-1.5" /> : null}
                    </div>
                    {entry.tone === "pending" ? <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">En attente</span> : null}
                    {entry.kind === "reservation" ? (
                      <Button size="sm" variant="secondary" onClick={() => openReservationDetailsFromPanel(entry.reservation._id)}>
                        <Info className="h-4 w-4" />Détails
                      </Button>
                    ) : entry.kind === "service" ? (
                      <Button size="sm" variant="secondary" onClick={() => openServiceDetailsFromPanel(entry.service._id)}>
                        <Info className="h-4 w-4" />Détails
                      </Button>
                    ) : entry.kind === "control" ? (
                        <Button size="sm" variant="secondary" onClick={() => onOpenVehicle(entry.vehicle._id)}>
                          <Info className="h-4 w-4" />Véhicule
                        </Button>
                    ) : (
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openTaskDetailsFromPanel(entry.task._id)}>
                          <Info className="h-4 w-4" />Détails
                        </Button>
                        <Select
                          value={entry.task.status}
                          disabled={!canEdit}
                          onChange={(event) => {
                            const nextStatus = event.target.value as TaskStatus;
                            // Clôturer impose le coût : on ouvre la fiche en
                            // édition plutôt que de laisser le serveur refuser.
                            if (nextStatus === "done" && !taskHasCost(entry.task)) {
                              setDayPanelOpen(false);
                              setClosingTaskId(entry.task._id);
                              setSelectedTaskId(entry.task._id);
                              return;
                            }
                            void onUpdateTask({
                              taskId: entry.task._id,
                              status: nextStatus,
                              priority: entry.task.priority,
                            });
                          }}
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
          </div>
        </aside>
      </div>
      <ReservationDetailsModal
        reservation={selectedReservation}
        canManage={canManageReservations}
        canDeleteForever={canDeleteForever}
        onClose={() => setSelectedReservationId(null)}
        onApprove={(reservationId) => decideAndClose(reservationId, "approved")}
        onReject={(reservationId) => decideAndClose(reservationId, "rejected")}
        onCancel={cancelReservationWithConfirmation}
      />
      <ServiceDetailsModal service={selectedService} onClose={() => setSelectedServiceId(null)} />
      <MaintenanceDetailsModal
        task={selectedTask}
        canEdit={canEdit}
        initialEditing={selectedTaskId !== null && selectedTaskId === closingTaskId}
        onClose={() => {
          setSelectedTaskId(null);
          setClosingTaskId(null);
        }}
        onUpdate={onUpdateTask}
      />
    </div>
  );
}

function ServiceDetailsModal({ service, onClose }: { service: ServiceItem | null; onClose: () => void }) {
  const computeDistance = useAction(api.gotravaux.computeServiceDistance);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [distanceError, setDistanceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const serviceId = service?._id ?? null;
  const fullAddress = service ? serviceAddressString(service) : "";

  useEffect(() => {
    setDistanceKm(null);
    setDistanceError(null);
    if (!serviceId || !service) return;
    if (!fullAddress) {
      setDistanceError("Aucune adresse renseignée pour ce service.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    computeDistance({
      address: service.address ?? "",
      postalCode: service.postalCode ?? undefined,
      city: service.city ?? undefined,
    })
      .then((result) => {
        if (!cancelled) setDistanceKm(result.distanceKm);
      })
      .catch((error: unknown) => {
        if (!cancelled) setDistanceError(error instanceof Error ? error.message : "Calcul de distance impossible.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  if (!service) return null;

  return (
    <Modal open onClose={onClose} title="Détail du service planifié">
      <div className="grid gap-4">
        <div className="flex items-center gap-3 rounded-xl bg-[var(--accent)] px-3 py-3">
          <div className="h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-[var(--muted)]">
            {service.vehiclePhotoUrl ? <img src={service.vehiclePhotoUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]"><CarFront className="h-6 w-6" /></div>}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">{SERVICE_LABELS[service.type]}</span>
              {service.reference ? <span className="text-sm font-semibold text-[var(--muted-foreground)]">#{service.reference}</span> : null}
            </div>
            <p className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">{service.vehicleName ?? "Véhicule"}{service.vehiclePlate ? ` · ${service.vehiclePlate}` : ""}</p>
          </div>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailItem label="Type de service" value={SERVICE_LABELS[service.type]} />
          <DetailItem label="Véhicule" value={service.vehicleName ?? "—"} />
          <DetailItem label="Date planifiée" value={formatDateTime(service.scheduledDate)} />
          {service.type === "collecte" ? (
            <DetailItem label="Planifié par" value={service.scheduledByName || "Non renseigné"} />
          ) : (
            <DetailItem label="Client" value={service.customerName || "—"} />
          )}
        </dl>

        <div className="rounded-xl border border-[var(--border)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]"><MapPin className="h-3.5 w-3.5" />Adresse</p>
          <p className="mt-1 text-sm text-[var(--foreground)]">{fullAddress || "Non renseignée"}</p>
        </div>

        <div className="rounded-xl border border-[var(--border)] p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]"><Route className="h-3.5 w-3.5" />Distance depuis le dépôt</p>
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">4 rue de la prairie 60650 Lachapelle-aux-Pots → adresse du service (aller simple)</p>
          {loading ? (
            <p className="mt-2 text-sm font-semibold text-[var(--foreground)]">Calcul en cours…</p>
          ) : distanceError ? (
            <p className="mt-2 text-sm font-semibold text-rose-600">{distanceError}</p>
          ) : distanceKm !== null ? (
            <p className="mt-2 text-lg font-bold text-[var(--foreground)]">{distanceKm.toLocaleString("fr-FR")} km</p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Temps + prix des pièces renseignés : conditions pour clôturer une tâche. */
/**
 * Ce qui manque à une maintenance pour pouvoir être clôturée. Miroir exact de
 * `ensureClosingRequirements` côté serveur : on nomme les champs manquants
 * avant le clic, le serveur reste seul juge.
 */
function missingClosingFields(
  task: Pick<VehicleTask, "laborMinutes" | "partsCost" | "dueDate" | "odometerKm">,
) {
  const missing: string[] = [];
  if (typeof task.laborMinutes !== "number" || task.laborMinutes <= 0) missing.push("le temps passé");
  if (typeof task.dueDate !== "number") missing.push("la date d'intervention");
  if (typeof task.odometerKm !== "number") missing.push("le kilométrage du véhicule");
  if (typeof task.partsCost !== "number") missing.push("le prix des pièces");
  return missing;
}

function taskHasCost(
  task: Pick<VehicleTask, "laborMinutes" | "partsCost" | "dueDate" | "odometerKm">,
) {
  return missingClosingFields(task).length === 0;
}

function MaintenanceDetailsModal({
  task,
  canEdit,
  onClose,
  onUpdate,
  initialEditing = false,
}: {
  task: VehicleTask | null;
  canEdit: boolean;
  onClose: () => void;
  onUpdate: ReturnType<typeof useMutation>;
  /** Ouvre directement en édition, statut « Terminée » présélectionné : utilisé
   *  quand on tente de clôturer une tâche sans en avoir saisi le coût. */
  initialEditing?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [range, setRange] = useState<DateRange>({ start: null, end: null });
  const [odometerKm, setOdometerKm] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [laborMins, setLaborMins] = useState("");
  const [partsCost, setPartsCost] = useState("");
  const [attachments, setAttachments] = useState<Id<"_storage">[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description ?? "");
    setPriority(task.priority);
    setStatus(initialEditing ? "done" : task.status);
    setRange({ start: task.dueDate ?? null, end: task.endDate ?? null });
    setOdometerKm(task.odometerKm !== undefined ? String(task.odometerKm) : "");
    setLaborHours(task.laborMinutes ? String(Math.floor(task.laborMinutes / 60)) : "");
    setLaborMins(task.laborMinutes ? String(task.laborMinutes % 60) : "");
    setPartsCost(typeof task.partsCost === "number" ? String(task.partsCost) : "");
    setAttachments(task.attachments ?? []);
    setError(null);
    // Ouvert depuis une tentative de clôture sans coût : on démarre en édition,
    // statut « Terminée » présélectionné, pour que l'utilisateur saisisse le
    // temps et le prix puis enregistre.
    setEditing(initialEditing);
  }, [task, initialEditing]);

  if (!task) return null;
  const currentTask = task;
  const displayTitle = title.trim() || currentTask.title;
  const displayDescription = description.trim() || "Aucune précision renseignée.";
  const displayVehicleName = currentTask.vehicle?.name ?? "Véhicule";
  const displayVehicleDetails = [currentTask.vehicle?.brand, currentTask.vehicle?.model, currentTask.vehicle?.plate]
    .filter(Boolean)
    .join(" · ");
  const displayStart = range.start ? formatDateTimeWithDay(range.start) : "Non renseigné";
  const displayEnd = range.end ? formatDateTimeWithDay(range.end) : "Non renseignée";
  const displayOdometer = odometerKm.trim()
    ? `${Number(odometerKm).toLocaleString("fr-FR")} km`
    : "Non renseigné";

  const laborMinutesValue =
    laborHours.trim() || laborMins.trim()
      ? (Number(laborHours) || 0) * 60 + (Number(laborMins) || 0)
      : null;
  const partsCostValue = partsCost.trim() ? Number(partsCost) : null;

  async function save() {
    if (!title.trim()) return;
    // Même règle que le serveur : clôturer impose temps passé, date
    // d'intervention, kilométrage et prix des pièces.
    if (status === "done") {
      const missing = missingClosingFields({
        laborMinutes: laborMinutesValue ?? undefined,
        partsCost: partsCostValue ?? undefined,
        dueDate: range.start ?? undefined,
        odometerKm: odometerKm.trim() ? Number(odometerKm) : undefined,
      });
      if (missing.length > 0) {
        setError(`Renseignez ${formatList(missing)} pour terminer la maintenance.`);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdate({
        taskId: currentTask._id,
        title,
        description,
        priority,
        status,
        dueDate: range.start ?? null,
        endDate: range.end ?? null,
        odometerKm: odometerKm ? Number(odometerKm) : null,
        laborMinutes: laborMinutesValue,
        partsCost: partsCostValue,
        attachments,
      });
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Détail de la maintenance" className="sm:max-w-4xl">
      {/* Onglet unique, comme la fiche demande du CRM recycapp : une seule vue
          « Maintenance » qui porte le détail et l'avancement. */}
      <UnderlineTabs
        className="mb-5"
        items={[{ key: "maintenance", label: "Maintenance", icon: Wrench }]}
        value="maintenance"
        onChange={() => {}}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--muted)]">
          {currentTask.vehicle?.photoUrl ? (
            <img src={currentTask.vehicle.photoUrl} alt={currentTask.vehicle?.name ?? "Véhicule"} className="h-full max-h-[60vh] min-h-64 w-full object-cover" />
          ) : (
            <div className="flex min-h-64 items-center justify-center text-[var(--muted-foreground)]">
              <CarFront className="h-14 w-14" />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={status} />
            <PriorityBadge priority={priority} />
            <MaintenanceCostBadges task={currentTask} />
            {canEdit ? (
              <Button
                size="sm"
                variant={editing ? "secondary" : "outline"}
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? "Annuler la modification" : "Modifier"}
              </Button>
            ) : null}
          </div>

          <div>
            <h2 className="text-2xl font-bold text-[var(--foreground)]">{displayTitle}</h2>
            <p className="mt-1 text-sm font-semibold text-[var(--muted-foreground)]">
              {displayVehicleName}
              {displayVehicleDetails
                ? ` · ${displayVehicleDetails}`
                : ""}
            </p>
          </div>

          <MaintenanceSteps
            task={currentTask}
            canEdit={canEdit}
            onChangeStatus={(nextStatus) => {
              setStatus(nextStatus);
              void onUpdate({ taskId: currentTask._id, status: nextStatus });
            }}
            onFixMissing={() => {
              setStatus("done");
              setEditing(true);
              setError(
                `Renseignez ${formatList(missingClosingFields(currentTask))} pour terminer la maintenance.`,
              );
            }}
          />

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <DetailItem label="Véhicule" value={displayVehicleName} />
            <DetailItem label="Créée par" value={currentTask.createdBy} />
            <DetailItem label="Début" value={displayStart} />
            <DetailItem label="Fin" value={displayEnd} />
            <DetailItem label="Créée le" value={formatDateTimeWithDay(currentTask.createdAt)} />
            <DetailItem label="Mise à jour" value={formatDateTimeWithDay(currentTask.updatedAt)} />
            <DetailItem label="Statut" value={TASK_STATUS_LABELS[status]} />
            <DetailItem label="Kilométrage" value={displayOdometer} />
            <DetailItem
              label="Temps passé"
              value={currentTask.laborMinutes ? formatLabor(currentTask.laborMinutes) : "Non renseigné"}
            />
            <DetailItem
              label="Prix des pièces"
              value={typeof currentTask.partsCost === "number" ? formatEuros(currentTask.partsCost) : "Non renseigné"}
            />
          </dl>

          <div className="rounded-xl border border-[var(--border)] p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Description</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">{displayDescription}</p>
          </div>

          {!editing && (currentTask.attachmentUrls?.length ?? 0) > 0 ? (
            <div className="rounded-xl border border-[var(--border)] p-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">
                Photos ({currentTask.attachmentUrls?.length})
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {currentTask.attachmentUrls?.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" title="Ouvrir en grand">
                    <img
                      src={url}
                      alt=""
                      className="h-24 w-full rounded-lg object-cover transition hover:opacity-90"
                    />
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {canEdit && editing ? (
            <div className="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--accent)] p-4">
              <Field label="Intitulé" required><Input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
              <Field label="Description"><Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Période"><DateRangePicker value={range} onChange={setRange} placeholder="Période de maintenance" /></Field>
                {/* Pas de sélecteur de statut ici : l'avancement passe par les
                    étapes ci-dessus, comme dans le CRM. */}
                <Field label="Priorité">
                  <Select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
                    <option value="low">Basse</option>
                    <option value="medium">Moyenne</option>
                    <option value="high">Haute</option>
                  </Select>
                </Field>
              </div>
              <Field label="Kilométrage">
                <Input type="number" inputMode="numeric" value={odometerKm} onChange={(event) => setOdometerKm(event.target.value)} placeholder="Ex: 125000" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Temps passé" hint="Obligatoire pour terminer">
                  <div className="flex items-center gap-2">
                    <Input type="number" inputMode="numeric" min="0" value={laborHours} onChange={(event) => setLaborHours(event.target.value)} placeholder="h" />
                    <span className="text-sm text-[var(--muted-foreground)]">h</span>
                    <Input type="number" inputMode="numeric" min="0" max="59" value={laborMins} onChange={(event) => setLaborMins(event.target.value)} placeholder="min" />
                    <span className="text-sm text-[var(--muted-foreground)]">min</span>
                  </div>
                </Field>
                <Field label="Prix des pièces (€)" hint="Obligatoire pour terminer">
                  <Input type="number" inputMode="decimal" min="0" step="0.01" value={partsCost} onChange={(event) => setPartsCost(event.target.value)} placeholder="Ex: 45,00" />
                </Field>
              </div>
              <Field label="Photos">
                {/* `initialMedia` réaffiche les photos déjà enregistrées : sans
                    lui, l'édition repartirait d'une galerie vide et un
                    enregistrement les effacerait. */}
                <MediaUpload
                  images={attachments}
                  initialMedia={(currentTask.attachments ?? []).map((storageId, index) => ({
                    storageId,
                    previewUrl: currentTask.attachmentUrls?.[index] ?? "",
                  }))}
                  onChange={setAttachments}
                />
              </Field>
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>
          ) : null}

          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={onClose}>Fermer</Button>
            {canEdit && editing ? (
              <Button onClick={() => void save()} disabled={saving || !title.trim()}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
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

function dateStringToLocalTimestamp(value?: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 9, 0, 0, 0).getTime();
}

function overlapsDay(start: number, end: number | undefined, dayStart: number) {
  const dayEnd = endOfDayTimestamp(dayStart);
  return start <= dayEnd && (end ?? start) >= dayStart;
}

function VehicleReservationsPanel() {
  const access = usePermissionsAccess();
  const canManage = canAccess(access, "mesoutils:reservations", "manage");
  const canDeleteForever = access?.email?.trim().toLowerCase() === "lahmerselim@gmail.com";
  const reservations = useQuery(api.reservations.listVehicleReservations, {}) as ReservationItem[] | undefined;
  const decide = useMutation(api.reservations.decideVehicleReservation);
  const cancel = useMutation(api.reservations.cancelVehicleReservation);
  const [selectedId, setSelectedId] = useState<Id<"vehicleReservations"> | null>(null);
  const [query, setQuery] = useState("");

  if (reservations === undefined) return <FullSpinner label="Chargement des réservations..." />;

  const needle = query.trim().toLowerCase();
  const visibleReservations = reservations.filter((reservation) => {
    if (!needle) return true;
    return [
      reservation.userName,
      reservation.bookedByName,
      reservation.purpose,
      reservation.vehicle?.name,
      reservation.vehicle?.brand,
      reservation.vehicle?.model,
      reservation.vehicle?.plate,
      reservation.status,
    ].filter(Boolean).join(" ").toLowerCase().includes(needle);
  });
  const pending = visibleReservations.filter((r) => r.status === "pending");
  const others = visibleReservations.filter((r) => r.status !== "pending");
  const selected = reservations.find((reservation) => reservation._id === selectedId) ?? null;

  async function decideAndClose(reservationId: Id<"vehicleReservations">, decision: "approved" | "rejected") {
    await decide({ reservationId, decision });
    setSelectedId(null);
  }

  async function cancelReservationWithConfirmation(reservationId: Id<"vehicleReservations">) {
    const message = canDeleteForever
      ? "Êtes-vous sûr(e) de vouloir supprimer définitivement cette réservation de véhicule ?"
      : "Annuler cette demande de réservation ? Elle restera visible dans l'historique.";
    if (!(await confirmPermanentDelete(message))) return;
    void cancel({ reservationId });
    setSelectedId(null);
  }

  return (
    <div className="space-y-6">
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher par nom, véhicule, plaque, motif..."
          className="pl-9"
        />
      </div>
      {reservations.length === 0 ? <EmptyState icon={<CalendarClock className="h-8 w-8" />} title="Aucune réservation" description="Les demandes de réservation apparaîtront ici." /> : null}
      {reservations.length > 0 && visibleReservations.length === 0 ? <EmptyState icon={<Search className="h-8 w-8" />} title="Aucun résultat" description="Aucune réservation ne correspond à votre recherche." /> : null}
      {pending.length > 0 ? (
        <section className="premium-panel overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-lg font-semibold text-[var(--foreground)]">À traiter ({pending.length})</h2></div>
          <div className="divide-y divide-[var(--border)]">
            {pending.map((r) => (
              <ReservationRow key={r._id} reservation={r} canManage={canManage} canDeleteForever={canDeleteForever} onOpen={() => setSelectedId(r._id)} onCancel={() => cancelReservationWithConfirmation(r._id)} />
            ))}
          </div>
        </section>
      ) : null}
      <section className="premium-panel overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="text-lg font-semibold text-[var(--foreground)]">Historique</h2></div>
        <div className="divide-y divide-[var(--border)]">
          {others.map((r) => <ReservationRow key={r._id} reservation={r} canManage={canManage} canDeleteForever={canDeleteForever} onOpen={() => setSelectedId(r._id)} onCancel={() => cancelReservationWithConfirmation(r._id)} />)}
        </div>
      </section>

      <ReservationDetailsModal
        reservation={selected}
        canManage={canManage}
        canDeleteForever={canDeleteForever}
        onClose={() => setSelectedId(null)}
        onApprove={(reservationId) => decideAndClose(reservationId, "approved")}
        onReject={(reservationId) => decideAndClose(reservationId, "rejected")}
        onCancel={cancelReservationWithConfirmation}
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
  status: "pending" | "approved" | "rejected" | "cancelled";
  decisionNote?: string;
  decidedBy?: string;
  decidedAt?: number;
};

function ReservationRow({ reservation, canManage, canDeleteForever, onOpen, onCancel }: { reservation: ReservationItem; canManage: boolean; canDeleteForever: boolean; onOpen: () => void; onCancel: () => void }) {
  return (
    <div className="data-row flex flex-wrap items-center gap-4 p-5">
      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--muted)]">
        {reservation.vehiclePhotoUrl ? <img src={reservation.vehiclePhotoUrl} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[var(--muted-foreground)]"><CarFront className="h-6 w-6" /></div>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-[var(--foreground)]">{reservation.vehicle?.name ?? "Véhicule"}</p><StatusBadge status={reservation.status} /></div>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{reservation.userName}{reservation.bookedByName ? ` (par ${reservation.bookedByName})` : ""} · {reservation.purpose}</p>
        <p className="text-xs text-[var(--muted-foreground)]">{formatDateTimeWithDay(reservation.start)} → {formatDateTimeWithDay(reservation.end)}</p>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant={reservation.status === "pending" && canManage ? "primary" : "secondary"} onClick={onOpen}>
          <Info className="h-4 w-4" />Détails
        </Button>
        {reservation.status !== "cancelled" ? (
          <button type="button" onClick={onCancel} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600" title={canDeleteForever ? "Supprimer" : "Annuler la demande"}><Trash2 className="h-4 w-4" /></button>
        ) : null}
      </div>
    </div>
  );
}

function ReservationDetailsModal({
  reservation,
  canManage,
  canDeleteForever,
  onClose,
  onApprove,
  onReject,
  onCancel,
}: {
  reservation: ReservationItem | null;
  canManage: boolean;
  canDeleteForever: boolean;
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
          <DetailItem label="Début" value={formatDateTimeWithDay(reservation.start)} />
          <DetailItem label="Fin" value={formatDateTimeWithDay(reservation.end)} />
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
          {reservation.status !== "cancelled" ? (
            <Button variant="outline" onClick={() => onCancel(reservation._id)}><Trash2 className="h-4 w-4" />{canDeleteForever ? "Supprimer" : "Annuler la demande"}</Button>
          ) : null}
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
  const styles = { approved: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200", pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", rejected: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200", cancelled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200" };
  const labels = { approved: "Approuvée", pending: "En attente", rejected: "Refusée", cancelled: "Annulée" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminée",
};

/** « 2 h 30 », « 45 min », « 3 h ». */
function formatLabor(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/** Montant en euros, format français. */
function formatEuros(amount: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(amount);
}

/**
 * Coût d'une intervention en petits badges — temps passé et prix des pièces —
 * repris du style des badges du CRM recyclerie. Affichés partout où une
 * maintenance apparaît (card kanban, miniature d'agenda, fiche). On n'affiche
 * un badge que si la valeur existe.
 */
function MaintenanceCostBadges({
  task,
  className,
}: {
  task: Pick<VehicleTask, "laborMinutes" | "partsCost">;
  className?: string;
}) {
  const hasLabor = typeof task.laborMinutes === "number" && task.laborMinutes > 0;
  const hasParts = typeof task.partsCost === "number";
  if (!hasLabor && !hasParts) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {hasLabor ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">
          <Clock className="h-3 w-3" />
          {formatLabor(task.laborMinutes as number)}
        </span>
      ) : null}
      {hasParts ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">
          <Euro className="h-3 w-3" />
          {formatEuros(task.partsCost as number)}
        </span>
      ) : null}
    </div>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const styles = {
    todo: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
    in_progress: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
    done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{TASK_STATUS_LABELS[status]}</span>;
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const map = { low: "bg-zinc-200 text-zinc-700 dark:bg-zinc-500/20 dark:text-zinc-200", medium: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", high: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200" };
  const label = { low: "Basse", medium: "Moyenne", high: "Haute" };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${map[priority]}`}>{label[priority]}</span>;
}
