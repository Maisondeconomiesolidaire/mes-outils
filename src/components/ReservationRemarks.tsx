import { useState } from "react";
import { useQuery } from "convex/react";
import { CarFront, Check, DoorOpen, MessageSquareText, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState } from "./ui/EmptyState";
import { FullSpinner } from "./ui/Spinner";
import { formatDate, formatDateTimeWithDay } from "../lib/format";

type Remark = {
  _id: string;
  assetName: string;
  photoUrl: string | null;
  userName: string;
  label: string;
  start: number;
  end: number;
  submittedAt: number;
  usageType?: "pro" | "personal";
  mileage?: number;
  lastRecordedMileage?: number;
  fuelRestored?: boolean;
  vehicleEmpty?: boolean;
  vehicleClean?: boolean;
  clean?: boolean;
  tidy?: boolean;
  issues?: string;
  notes?: string;
};

type VehicleAnalysis = {
  _id: Id<"vehicleRemarkAnalyses">;
  vehicleId: Id<"vehicles">;
  vehicleName: string;
  summary: string;
  proposals: Array<{ title: string; description: string; priority: "low" | "medium" | "high" }>;
  sourceRemarkCount: number;
  updatedAt: number;
};

type MaintenanceProposal = {
  vehicleId: Id<"vehicles">;
  title: string;
  description: string;
  priority: "low" | "medium" | "high";
};

/** Petit indicateur oui/non (vert/rouge) pour un point de contrôle. */
function Check3({ label, value }: { label: string; value?: boolean }) {
  if (value === undefined) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        value
          ? "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200"
          : "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200"
      }`}
    >
      {value ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

/**
 * Liste des remarques (retours) laissées par les utilisateurs après leurs
 * réservations, pour les encadrants. Véhicules (Gotravaux) ou salles (Salles).
 */
export function ReservationRemarks({
  kind,
  vehicleId,
  onCreateMaintenance,
}: {
  kind: "vehicle" | "room";
  /** Restreint aux remarques d'un véhicule précis (onglet dans la fiche véhicule). */
  vehicleId?: Id<"vehicles">;
  onCreateMaintenance?: (proposal: MaintenanceProposal) => void;
}) {
  const [vehicleTab, setVehicleTab] = useState<"remarks" | "analyses">("remarks");
  const vehicleRemarks = useQuery(
    api.reservations.listVehicleRemarks,
    kind === "vehicle" ? { vehicleId } : "skip",
  );
  const roomRemarks = useQuery(
    api.reservations.listRoomRemarks,
    kind === "room" ? {} : "skip",
  );
  const vehicleAnalyses = useQuery(
    api.vehicleRemarkAnalysis.list,
    kind === "vehicle" ? { vehicleId } : "skip",
  ) as VehicleAnalysis[] | undefined;
  const data = (kind === "vehicle" ? vehicleRemarks : roomRemarks) as Remark[] | undefined;

  if (data === undefined || (kind === "vehicle" && vehicleAnalyses === undefined)) return <FullSpinner label="Chargement des remarques..." />;
  if (data.length === 0 && (kind !== "vehicle" || vehicleAnalyses?.length === 0)) {
    return (
      <EmptyState
        icon={<MessageSquareText className="h-8 w-8" />}
        title="Aucune remarque"
        description={`Les retours laissés après les réservations de ${
          kind === "vehicle" ? "véhicules" : "salles"
        } apparaîtront ici.`}
      />
    );
  }

  return (
    <div className="space-y-3">
      {kind === "vehicle" ? (
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--accent)] p-1">
          <button
            type="button"
            onClick={() => setVehicleTab("remarks")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${vehicleTab === "remarks" ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
          >
            Remarques ({data.length})
          </button>
          <button
            type="button"
            onClick={() => setVehicleTab("analyses")}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${vehicleTab === "analyses" ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"}`}
          >
            Analyses IA ({vehicleAnalyses?.length ?? 0})
          </button>
        </div>
      ) : null}

      {kind === "vehicle" && vehicleTab === "analyses" ? (
        vehicleAnalyses?.length ? (
        <section className="border-b border-[var(--border)] pb-6">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Synthèse IA des retours</p>
          <div className="mt-3 space-y-6">
            {vehicleAnalyses.map((analysis) => (
              <div key={analysis._id}>
                {!vehicleId ? <p className="font-semibold text-[var(--foreground)]">{analysis.vehicleName}</p> : null}
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{analysis.summary}</p>
                {analysis.proposals.length ? (
                  <div className="mt-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Maintenances proposées</p>
                    {analysis.proposals.map((proposal, index) => (
                      <div key={`${analysis._id}-${proposal.title}-${index}`} className="border-l-2 border-[var(--foreground)] pl-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-[var(--foreground)]">{proposal.title}</p>
                            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{proposal.description}</p>
                          </div>
                          {onCreateMaintenance ? (
                            <button
                              type="button"
                              onClick={() => onCreateMaintenance({ vehicleId: analysis.vehicleId, ...proposal })}
                              className="shrink-0 border-b border-[var(--foreground)] pb-0.5 text-xs font-semibold text-[var(--foreground)] hover:opacity-70"
                            >
                              Effectuer cette maintenance
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
        ) : (
          <EmptyState icon={<MessageSquareText className="h-8 w-8" />} title="Aucune analyse IA" description="Une synthèse apparaîtra après le prochain retour de véhicule." />
        )
      ) : null}
      {(kind !== "vehicle" || vehicleTab === "remarks") ? data.map((remark) => (
        <div key={remark._id} className="premium-panel rounded-2xl p-4">
          <div className="flex flex-wrap items-start gap-3">
            <span className="h-12 w-16 shrink-0 overflow-hidden rounded-xl bg-[var(--accent)]">
              {remark.photoUrl ? (
                <img src={remark.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[var(--muted-foreground)]">
                  {kind === "vehicle" ? <CarFront className="h-5 w-5" /> : <DoorOpen className="h-5 w-5" />}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--foreground)]">{remark.assetName}</p>
              <p className="truncate text-sm text-[var(--muted-foreground)]">
                {remark.userName} · {remark.label}
              </p>
              <p className="text-xs text-[var(--muted-foreground)]">
                {formatDateTimeWithDay(remark.start)} → {formatDateTimeWithDay(remark.end)}
              </p>
            </div>
            <span className="whitespace-nowrap text-xs text-[var(--muted-foreground)]">
              Retour le {formatDate(remark.submittedAt)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {kind === "vehicle" ? (
              <>
                {remark.lastRecordedMileage !== undefined ? (
                  <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)]">
                    Dernier relevé : {remark.lastRecordedMileage.toLocaleString("fr-FR")} km
                  </span>
                ) : null}
                {remark.mileage !== undefined ? (
                  <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)]">
                    Retour utilisateur : {remark.mileage.toLocaleString("fr-FR")} km
                  </span>
                ) : null}
                {remark.usageType === "personal" ? (
                  <Check3 label="Essence remise" value={remark.fuelRestored} />
                ) : null}
                <Check3 label="Rien laissé" value={remark.vehicleEmpty} />
                <Check3 label="Véhicule propre" value={remark.vehicleClean} />
              </>
            ) : (
              <>
                <Check3 label="Salle propre" value={remark.clean} />
                <Check3 label="Salle rangée" value={remark.tidy} />
              </>
            )}
          </div>

          {remark.issues ? (
            <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Incident / remarque
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--foreground)]">{remark.issues}</p>
            </div>
          ) : null}
          {remark.notes ? (
            <div className="mt-2 rounded-xl border border-[var(--border)] px-3 py-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                Commentaire
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--foreground)]">{remark.notes}</p>
            </div>
          ) : null}
        </div>
      )) : null}
    </div>
  );
}
