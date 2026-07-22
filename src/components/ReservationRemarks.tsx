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
  vehiclePhotoUrl: string | null;
  summary: string;
  diagnosis?: string;
  webSources?: Array<{ title: string; url: string }>;
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

/** Rendu léger et sûr du format Markdown imposé à l'avis mécanique IA. */
function MechanicOpinion({ children }: { children: string }) {
  const renderBold = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
      part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>,
    );

  return (
    <div className="mt-2 space-y-2.5 text-sm leading-6 text-[var(--foreground)]">
      {children.split("\n").map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={index} className="h-1" />;
        if (trimmed.startsWith("- ")) return <p key={index} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" />{renderBold(trimmed.slice(2))}</p>;
        if (/^\*\*[^*]+\*\*$/.test(trimmed)) return <p key={index} className="pt-1 text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">{trimmed.slice(2, -2)}</p>;
        return <p key={index}>{renderBold(trimmed)}</p>;
      })}
    </div>
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
        <section className="space-y-7">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Synthèse IA des retours</p>
          <div className="mt-3 space-y-6">
            {vehicleAnalyses.map((analysis) => (
              <div key={analysis._id} className="border-t border-[var(--border)] pt-6 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-3">
                  <span className="h-14 w-20 shrink-0 overflow-hidden rounded-xl bg-[var(--accent)]">
                    {analysis.vehiclePhotoUrl ? (
                      <img src={analysis.vehiclePhotoUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[var(--muted-foreground)]"><CarFront className="h-5 w-5" /></span>
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--foreground)]">{analysis.vehicleName}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">Analyse de {analysis.sourceRemarkCount} retour{analysis.sourceRemarkCount > 1 ? "s" : ""}</p>
                  </div>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{analysis.summary}</p>
                {analysis.diagnosis ? (
                  <div className="mt-6 max-w-3xl border-l-4 border-sky-600 pl-4 dark:border-sky-400">
                    <p className="text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-200">Avis du mécanicien IA · à confirmer en atelier</p>
                    <MechanicOpinion>{analysis.diagnosis}</MechanicOpinion>
                  </div>
                ) : null}
                {analysis.webSources?.length ? (
                  <div className="mt-4 max-w-3xl border-l-2 border-[var(--border)] pl-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Sources techniques consultées</p>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {analysis.webSources.map((source) => (
                        <li key={source.url}>
                          <a href={source.url} target="_blank" rel="noreferrer" className="underline decoration-[var(--muted-foreground)] underline-offset-4 hover:opacity-70">
                            {source.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {analysis.proposals.length ? (
                  <div className="mt-7 max-w-3xl space-y-5 border-t border-[var(--border)] pt-5">
                    <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">Maintenances proposées</p>
                    {[...analysis.proposals].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - ({ high: 0, medium: 1, low: 2 }[b.priority]))).map((proposal, index) => {
                      const priorityStyle = proposal.priority === "high"
                        ? { label: "Priorité élevée", border: "border-red-500 dark:border-red-400", badge: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" }
                        : proposal.priority === "medium"
                          ? { label: "Priorité moyenne", border: "border-orange-500 dark:border-orange-400", badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200" }
                          : { label: "Priorité faible", border: "border-emerald-500 dark:border-emerald-400", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200" };
                      return <div key={`${analysis._id}-${proposal.title}-${index}`} className={`border-l-2 pl-4 ${priorityStyle.border}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--foreground)]">{proposal.title}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${priorityStyle.badge}`}>{priorityStyle.label}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{proposal.description}</p>
                        {onCreateMaintenance ? (
                          <button
                            type="button"
                            onClick={() => onCreateMaintenance({ vehicleId: analysis.vehicleId, ...proposal })}
                            className="mt-4 block border-b border-[var(--foreground)] pb-0.5 text-xs font-semibold text-[var(--foreground)] hover:opacity-70"
                          >
                            Effectuer cette maintenance
                          </button>
                        ) : null}
                      </div>;
                    })}
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
            <div className="mt-4 border-l-4 border-amber-500 pl-4 dark:border-amber-400">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Incident / remarque
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{remark.issues}</p>
            </div>
          ) : null}
          {remark.notes ? (
            <div className="mt-4 border-l-2 border-[var(--border)] pl-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted-foreground)]">
                Commentaire
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{remark.notes}</p>
            </div>
          ) : null}
        </div>
      )) : null}
    </div>
  );
}
