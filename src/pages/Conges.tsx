import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarRange, CheckCircle2, Clock3, ShieldAlert, XCircle } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { SectionHeader } from "../components/SectionHeader";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { DatePicker } from "../components/ui/DatePicker";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Select, Textarea } from "../components/ui/Field";
import { FullSpinner } from "../components/ui/Spinner";
import { cn } from "../lib/cn";

type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
type LeaveType = "cp" | "rtt" | "sans_solde" | "maladie" | "autre";

type LeaveItem = {
  _id: Id<"leaveRequests">;
  requesterName: string;
  requesterEmail?: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  note?: string;
  decisionNote?: string;
  decidedAt?: number;
  decidedByName?: string;
  createdAt: number;
};

const LEAVE_TYPE_LABEL: Record<LeaveType, string> = {
  cp: "Congés payés",
  rtt: "RTT",
  sans_solde: "Sans solde",
  maladie: "Maladie",
  autre: "Autre",
};

const STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: "En attente",
  approved: "Acceptée",
  rejected: "Refusée",
  cancelled: "Annulée",
};

export function Conges() {
  const access = usePermissionsAccess();
  const data = useQuery(api.leaves.listMine);
  const createLeave = useMutation(api.leaves.create);
  const cancelLeave = useMutation(api.leaves.cancel);
  const decideLeave = useMutation(api.leaves.decide);

  const [type, setType] = useState<LeaveType>("cp");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [decisionNote, setDecisionNote] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rangeError = useMemo(() => {
    if (!startDate || !endDate) return null;
    return endDate < startDate
      ? "La date de fin doit être postérieure ou égale à la date de début."
      : null;
  }, [startDate, endDate]);

  if (access === undefined || data === undefined) {
    return <FullSpinner label="Chargement des congés..." />;
  }

  async function handleSubmit() {
    if (!startDate || !endDate || rangeError) return;
    setSaving(true);
    setError(null);
    try {
      await createLeave({
        type,
        startDate,
        endDate,
        note: note.trim() || undefined,
      });
      setType("cp");
      setStartDate("");
      setEndDate("");
      setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Impossible d'enregistrer la demande.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(leaveId: Id<"leaveRequests">) {
    setActingId(leaveId);
    setError(null);
    try {
      await cancelLeave({ leaveId });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Annulation impossible.");
    } finally {
      setActingId(null);
    }
  }

  async function handleDecision(leaveId: Id<"leaveRequests">, status: "approved" | "rejected") {
    setActingId(leaveId);
    setError(null);
    try {
      await decideLeave({
        leaveId,
        status,
        decisionNote: decisionNote[leaveId]?.trim() || undefined,
      });
      setDecisionNote((current) => ({ ...current, [leaveId]: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action impossible.");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Congés"
        subtitle="Posez vos absences, puis suivez leur traitement."
      />

      <section className="premium-panel rounded-2xl p-5">
        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Type d'absence">
                <Select value={type} onChange={(event) => setType(event.target.value as LeaveType)}>
                  {Object.entries(LEAVE_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Début" required>
                <DatePicker value={startDate} onChange={setStartDate} />
              </Field>
              <Field label="Fin" required>
                <DatePicker value={endDate} onChange={setEndDate} />
              </Field>
            </div>

            <Field
              label="Commentaire"
              hint="Contexte, relai, précision utile à l'équipe."
            >
              <Textarea
                rows={4}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex. déplacement personnel, organisation d'équipe, rendez-vous médical..."
              />
            </Field>

            {rangeError ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {rangeError}
              </p>
            ) : null}
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={handleSubmit} disabled={saving || !startDate || !endDate || Boolean(rangeError)}>
                {saving ? "Enregistrement..." : "Poser ma demande"}
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--accent)]/60 p-4">
            <p className="text-sm font-semibold text-[var(--foreground)]">Aperçu</p>
            <div className="mt-4 space-y-3 text-sm">
              <RecapRow label="Type" value={LEAVE_TYPE_LABEL[type]} />
              <RecapRow label="Début" value={startDate ? formatDay(startDate) : "À définir"} />
              <RecapRow label="Fin" value={endDate ? formatDay(endDate) : "À définir"} />
              <RecapRow
                label="Durée"
                value={startDate && endDate && !rangeError ? durationLabel(startDate, endDate) : "À définir"}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-[var(--muted-foreground)]" />
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Mes demandes</h2>
        </div>
        {data.mine.length === 0 ? (
          <EmptyState
            title="Aucune demande"
            description="Vos demandes de congés apparaîtront ici."
          />
        ) : (
          <div className="grid gap-3">
            {data.mine.map((leave) => (
              <LeaveCard
                key={leave._id}
                leave={leave}
                action={
                  leave.status === "pending" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actingId === leave._id}
                      onClick={() => void handleCancel(leave._id)}
                    >
                      Annuler
                    </Button>
                  ) : null
                }
              />
            ))}
          </div>
        )}
      </section>

      {data.isAdmin ? (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[var(--muted-foreground)]" />
            <h2 className="text-lg font-semibold text-[var(--foreground)]">Demandes en attente</h2>
          </div>
          {data.pendingAll.length === 0 ? (
            <EmptyState
              title="Rien en attente"
              description="Aucune demande de congés n'attend de validation."
            />
          ) : (
            <div className="grid gap-4">
              {data.pendingAll.map((leave) => (
                <div key={leave._id} className="premium-panel rounded-2xl p-5">
                  <LeaveCard leave={leave} />
                  <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                    <Textarea
                      rows={2}
                      value={decisionNote[leave._id] ?? ""}
                      onChange={(event) =>
                        setDecisionNote((current) => ({
                          ...current,
                          [leave._id]: event.target.value,
                        }))
                      }
                      placeholder="Note interne ou motif éventuel..."
                    />
                    <Button
                      variant="secondary"
                      disabled={actingId === leave._id}
                      onClick={() => void handleDecision(leave._id, "approved")}
                    >
                      Valider
                    </Button>
                    <Button
                      variant="danger"
                      disabled={actingId === leave._id}
                      onClick={() => void handleDecision(leave._id, "rejected")}
                    >
                      Refuser
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function LeaveCard({
  leave,
  action,
}: {
  leave: LeaveItem;
  action?: React.ReactNode;
}) {
  return (
    <article className="premium-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-[var(--foreground)]">{leave.requesterName}</p>
            <StatusBadge status={leave.status} />
          </div>
          <p className="text-sm text-[var(--muted-foreground)]">
            {LEAVE_TYPE_LABEL[leave.type]} · {formatDay(leave.startDate)} → {formatDay(leave.endDate)}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Demandé le {format(new Date(leave.createdAt), "d MMM yyyy à HH:mm", { locale: fr })}
          </p>
        </div>
        {action}
      </div>

      {leave.note ? (
        <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--accent)] px-3 py-2 text-sm text-[var(--foreground)]">
          {leave.note}
        </p>
      ) : null}

      {leave.decidedByName || leave.decisionNote ? (
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm">
          {leave.decidedByName ? (
            <p className="font-medium text-[var(--foreground)]">
              Traitée par {leave.decidedByName}
              {leave.decidedAt
                ? ` le ${format(new Date(leave.decidedAt), "d MMM yyyy à HH:mm", { locale: fr })}`
                : ""}
            </p>
          ) : null}
          {leave.decisionNote ? (
            <p className="mt-1 text-[var(--muted-foreground)]">{leave.decisionNote}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function StatusBadge({ status }: { status: LeaveStatus }) {
  const Icon =
    status === "approved"
      ? CheckCircle2
      : status === "rejected"
        ? XCircle
        : status === "cancelled"
          ? ShieldAlert
          : Clock3;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
        status === "approved" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
        status === "rejected" && "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
        status === "cancelled" && "border-zinc-400/40 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
        status === "pending" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function RecapRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="text-right font-medium text-[var(--foreground)]">{value}</span>
    </div>
  );
}

function formatDay(value: string) {
  return format(parseISO(value), "EEEE d MMMM yyyy", { locale: fr });
}

function durationLabel(startDate: string, endDate: string) {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  return days <= 1 ? "1 jour" : `${days} jours`;
}
