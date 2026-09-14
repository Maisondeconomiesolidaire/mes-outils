import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { Plus } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "../ui/Button";
import { CalendarBoard } from "../ui/CalendarBoard";
import { DateTimePicker } from "../ui/DateTimePicker";
import { Modal } from "../ui/Modal";
import { PhotoUpload } from "../ui/PhotoUpload";
import { Field, Textarea } from "../ui/Field";
import { FacebookPageMultiSelect } from "./FacebookPageMultiSelect";
import { cn } from "../../lib/cn";

const statuses: Record<string, string> = { scheduled: "Programmée", publishing: "En cours d'envoi", published: "Publiée", failed: "Échec", cancelled: "Annulée" };
const dateLabel = (date: number) => new Date(date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

export function SocialWorkspace({ canPublish, canCreate }: { canPublish: boolean; canCreate: boolean }) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()).getTime());
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const cancel = useMutation(api.socialComposer.cancel);
  const entries = useQuery(api.socialComposer.list, {
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }).getTime(),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }).getTime() + 1,
  });
  const detail = entries?.find(entry => entry.id === selected);
  const history = entries?.filter(entry => entry.date >= startOfMonth(month).getTime() && entry.date < startOfMonth(addMonths(month, 1)).getTime());
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Publications sur les réseaux</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Facebook et Instagram · calendrier et historique</p></div>
      {canPublish && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau post</Button>}
    </div>
    {notice && <p role="status" className="rounded-xl bg-brand-500/10 p-3 text-sm">{notice}</p>}
    <CalendarBoard month={month} onMonthChange={date => setMonth(date.getTime())} events={(entries ?? []).filter(entry => entry.status !== "cancelled").map(entry => ({ id: entry.id, start: entry.date, title: `${entry.targetName} · ${statuses[entry.status]}`, subtitle: entry.message, tone: entry.status === "failed" ? "rose" : entry.status === "scheduled" ? "amber" : "brand" }))} onEventClick={id => { setSelected(id); setError(""); }} />
    <section className="space-y-3">
      <h3 className="font-semibold">Historique et programmations · {new Date(month).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</h3>
      {entries === undefined ? <p role="status">Chargement des publications…</p> : history?.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">Aucune publication ce mois-ci. Parcourez le calendrier pour consulter les autres mois.</p> : <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
        {history?.map(entry => <button key={entry.id} onClick={() => { setSelected(entry.id); setError(""); }} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-[var(--accent)]">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{entry.network === "facebook" ? "Facebook" : "Instagram"} · {entry.targetName}</p><p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">{entry.message || "Publication photo"}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{dateLabel(entry.date)} · {entry.authorName}</p></div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-medium", entry.status === "failed" ? "bg-red-100 text-red-800" : entry.status === "scheduled" ? "bg-amber-100 text-amber-900" : "bg-[var(--accent)]")}>{statuses[entry.status]}</span>
        </button>)}
      </div>}
    </section>
    {creating && <SocialComposer canCreate={canCreate} onClose={() => setCreating(false)} onCreated={scheduled => { setCreating(false); if (scheduled) setMonth(startOfMonth(scheduled).getTime()); setNotice(scheduled ? "Publication programmée. Retrouvez le suivi de chaque page dans le calendrier." : "Publication enregistrée. Les envois sont en cours et leur résultat apparaît ci-dessous."); }} />}
    <Modal open={Boolean(detail)} onClose={() => setSelected(null)} title="Détail de la publication">
      {detail && <div className="space-y-4">
        <p className="font-semibold">{detail.network === "facebook" ? "Facebook" : "Instagram"} · {detail.targetName}</p>
        <p className="text-sm">{statuses[detail.status]} · {dateLabel(detail.date)} · {detail.authorName}</p>
        <p className="whitespace-pre-wrap">{detail.message || "Publication photo"}</p>
        {detail.mesoutils && <p className="text-sm text-brand-700">Également publié sur Mes Outils.</p>}
        {detail.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{detail.error}</p>}
        {detail.network === "facebook" && detail.postId && detail.status === "published" && <a href={`https://www.facebook.com/${encodeURIComponent(detail.postId)}`} target="_blank" rel="noreferrer" className="text-brand-700 underline">Voir sur Facebook</a>}
        {canPublish && detail.deliveryId && detail.status === "scheduled" && <Button disabled={cancelling} variant="secondary" onClick={async () => {
          setCancelling(true); setError("");
          try { await cancel({ id: detail.deliveryId! }); } catch (err) { setError(err instanceof Error ? err.message : "Annulation impossible."); } finally { setCancelling(false); }
        }}>Annuler cette programmation</Button>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>}
    </Modal>
  </div>;
}

function Choice({ selected, children, onClick, disabled = false }: { selected: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={cn("rounded-xl border px-5 py-3 text-sm font-medium transition disabled:opacity-40", selected ? "border-brand-500 bg-brand-500/10 text-brand-700" : "border-[var(--border)] hover:bg-[var(--accent)]")}>{children}</button>;
}

function SocialComposer({ canCreate, onClose, onCreated }: { canCreate: boolean; onClose: () => void; onCreated: (date?: number) => void }) {
  const pages = useQuery(api.social.listPages, {});
  const accounts = useQuery(api.social.listInstagramAccounts, {});
  const create = useMutation(api.socialComposer.create);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(0);
  const [facebook, setFacebook] = useState(false);
  const [instagram, setInstagram] = useState(false);
  const [facebookIds, setFacebookIds] = useState<string[]>([]);
  const [instagramIds, setInstagramIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previews, setPreviews] = useState<{ storageId: Id<"_storage">; previewUrl: string }[]>([]);
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [date, setDate] = useState<number | null>(null);
  const [mesoutils, setMesoutils] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const validTargets = (facebook || instagram) && (!facebook || facebookIds.length > 0) && (!instagram || instagramIds.length > 0);
  function next() {
    setError("");
    if (step === 0 && !validTargets) { setError("Choisissez au moins une page pour chaque réseau sélectionné."); return; }
    if (step === 1) {
      if (!message.trim() && !images.length) { setError("Ajoutez du texte ou une photo."); return; }
      if (instagram && !images.length) { setError("Ajoutez au moins une photo pour Instagram."); return; }
      if (images.length > 10) { setError("Vous pouvez joindre au maximum 10 photos."); return; }
      if (scheduled && (!date || date < Date.now() + 60_000)) { setError("Choisissez une date au moins une minute dans le futur."); return; }
    }
    setStep(step + 1);
  }
  return <Modal open onClose={() => { if (!busy) onClose(); }} title="Nouveau post sur les réseaux">
    <div className="mx-auto max-w-3xl space-y-6">
      <ol className="flex gap-2 text-sm">{["Réseaux et pages", "Votre post", "Mes Outils"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={cn("flex-1 rounded-full px-3 py-2 text-center", step === index ? "bg-brand-500 text-white" : "bg-[var(--accent)]")}>{index + 1}. {label}</li>)}</ol>
      {step === 0 && <div className="space-y-5">
        <h3 className="text-lg font-semibold">Où souhaitez-vous publier ?</h3>
        <div className="flex gap-3"><Choice selected={facebook} onClick={() => setFacebook(!facebook)}>Facebook</Choice><Choice selected={instagram} onClick={() => setInstagram(!instagram)}>Instagram</Choice></div>
        {facebook && <section className="space-y-3"><h4 className="font-medium">Pages Facebook</h4>{pages === undefined ? <p>Chargement…</p> : !pages.length ? <p>Aucune page Facebook connectée.</p> : <FacebookPageMultiSelect pages={pages} value={facebookIds} onChange={setFacebookIds} />}</section>}
        {instagram && <section className="space-y-3"><h4 className="font-medium">Comptes Instagram</h4>{accounts === undefined ? <p>Chargement…</p> : !accounts.length ? <p className="text-sm text-[var(--muted-foreground)]">Aucun compte Instagram connecté. Un compte professionnel doit être rattaché à une page Facebook configurée.</p> : <div className="flex flex-wrap gap-2">{accounts.map(account => <Choice key={account.instagramId} selected={instagramIds.includes(account.instagramId)} onClick={() => setInstagramIds(ids => ids.includes(account.instagramId) ? ids.filter(id => id !== account.instagramId) : [...ids, account.instagramId])}>@{account.username}</Choice>)}</div>}</section>}
      </div>}
      <div hidden={step !== 1} className="space-y-5">
        <Field label="Texte du post"><Textarea aria-label="Texte du post" rows={7} value={message} maxLength={instagram ? 2200 : 63206} onChange={event => setMessage(event.target.value)} placeholder="Que souhaitez-vous partager ?" /></Field>
        <div><p className="mb-2 text-sm font-medium">Photos · 10 maximum{instagram ? " · JPEG pour Instagram" : ""}</p><PhotoUpload jpeg value={images} onChange={setImages} onUploadingChange={setUploading} onPreviewsChange={setPreviews} /></div>
        <div className="flex flex-wrap gap-3"><Choice selected={!scheduled} onClick={() => setScheduled(false)}>Publier maintenant</Choice><Choice selected={scheduled} onClick={() => setScheduled(true)}>Programmer</Choice></div>
        {scheduled && <Field label="Date et heure de publication sur les réseaux"><DateTimePicker value={date} onChange={setDate} /></Field>}
      </div>
      {step === 2 && <div className="space-y-5">
        <div className="rounded-2xl bg-[var(--accent)] p-4"><p className="text-sm font-medium">{facebook ? `${facebookIds.length} page(s) Facebook` : ""}{facebook && instagram ? " · " : ""}{instagram ? `${instagramIds.length} compte(s) Instagram` : ""}</p><p className="mt-1 text-sm">{scheduled && date ? `Programmation : ${dateLabel(date)}` : "Publication immédiate sur les réseaux"}</p><p className="mt-3 whitespace-pre-wrap text-sm">{message || "Publication photo"}</p><p className="mt-2 text-xs">{images.length} photo(s)</p></div>
        <div className="flex flex-wrap gap-2">{previews.map(photo => <img key={photo.storageId} src={photo.previewUrl} alt="Photo du post" className="h-24 w-24 rounded-xl object-cover" />)}</div>
        <h3 className="text-lg font-semibold">Souhaitez-vous publier ce post sur Mes Outils ?</h3>
        <div className="flex gap-3"><Choice selected={mesoutils === true} disabled={!canCreate} onClick={() => setMesoutils(true)}>Oui</Choice><Choice selected={mesoutils === false} onClick={() => setMesoutils(false)}>Non</Choice></div>
        <p className="text-sm text-[var(--muted-foreground)]">{canCreate ? "Si vous choisissez Oui, le post et ses photos apparaîtront immédiatement dans les Posts de Mes Outils, même si les réseaux sont programmés pour plus tard." : "Votre accès ne permet pas de créer un post sur Mes Outils. Vous pouvez publier sur les réseaux en choisissant Non."}</p>
      </div>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex justify-between border-t border-[var(--border)] pt-4">
        <Button variant="secondary" disabled={busy} onClick={() => step ? setStep(step - 1) : onClose()}>{step ? "Retour" : "Annuler"}</Button>
        {step < 2 ? <Button disabled={uploading} onClick={next}>{uploading ? "Photos en cours…" : "Continuer"}</Button> : <Button disabled={busy || mesoutils === null} onClick={async () => {
          setBusy(true); setError("");
          try {
            await create({ requestKey, message, images, facebookIds: facebook ? facebookIds : [], instagramIds: instagram ? instagramIds : [], scheduledFor: scheduled ? date ?? undefined : undefined, publishOnMesoutils: mesoutils === true });
            onCreated(scheduled ? date ?? undefined : undefined);
          } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'enregistrer la publication."); } finally { setBusy(false); }
        }}>{busy ? "Enregistrement…" : scheduled ? "Confirmer la programmation" : "Publier"}</Button>}
      </div>
    </div>
  </Modal>;
}
