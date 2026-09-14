import { PublicationConfetti } from "./PublicationConfetti";
import { PublishedPostEmbed } from "./PublishedPostEmbed";
import { SocialAiAssistant } from "./SocialAiAssistant";
import { FacebookIcon } from "../icons/FacebookIcon";
import { InstagramIcon } from "../icons/InstagramIcon";
import { FacebookPostPreview, InstagramPostPreview } from "./PostPreview";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { addMonths, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
import { confirmPermanentDelete } from "../../lib/confirm";
import { ALL_TARGETS, SocialTargetFilter, type SocialTarget } from "./SocialTargetFilter";

const statuses: Record<string, string> = { scheduled: "Programmée", publishing: "En cours d'envoi", published: "Publiée", failed: "Échec", cancelled: "Annulée" };
const dateLabel = (date: number) => new Date(date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

/** Remis à zéro par un vrai rechargement de page, pas par une navigation interne. */
let syncedThisPageLoad = false;

export function SocialWorkspace({ canPublish, canCreate }: { canPublish: boolean; canCreate: boolean }) {
  const refresh = useAction(api.socialSync.refresh);
  const syncStatus = useQuery(api.socialSync.status, {});
  const [refreshing, setRefreshing] = useState(false);
  // Un clic pendant la synchronisation automatique ne relance rien côté
  // serveur : le bouton tourne alors jusqu'à la fin du passage en cours.
  const [awaitingSync, setAwaitingSync] = useState(false);
  const [syncError, setSyncError] = useState("");
  const busy = refreshing || awaitingSync;
  // Le bail de synchronisation expire avec le temps, pas avec une écriture :
  // on le réévalue nous-mêmes tant qu'il court, sinon l'attente d'un passage
  // déjà mort ne se terminerait jamais.
  const leaseUntil = syncStatus?.leaseUntil ?? 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (leaseUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [leaseUntil]);
  const running = leaseUntil > now;
  useEffect(() => {
    if (!refreshing && awaitingSync && !running) setAwaitingSync(false);
  }, [refreshing, awaitingSync, running]);
  useEffect(() => {
    // Une seule synchronisation automatique par chargement de page : revenir
    // sur l'onglet remonte ce composant, et relancer un passage de ~1 min à
    // chaque fois n'apporte rien. Elle reste silencieuse (le bouton ne tourne
    // que sur clic) ; son avancement est visible dans la ligne d'état.
    if (syncedThisPageLoad) return;
    syncedThisPageLoad = true;
    let mounted = true;
    refresh({ auto: true }).catch(() => { if (mounted) setSyncError("Impossible de joindre les réseaux. Les publications sont conservées."); });
    return () => { mounted = false; };
  }, [refresh]);
  const [month, setMonth] = useState(() => startOfMonth(new Date()).getTime());
  const [pendingPublication, setPendingPublication] = useState<Id<"socialCompositions"> | null>(null);
  const [burst, setBurst] = useState(0);
  const publication = useQuery(api.socialEnhancements.publicationStatus, pendingPublication ? { id: pendingPublication } : "skip");
  useEffect(() => {
    if (!publication || publication.pending || !publication.total) return;
    if (publication.published === publication.total) {
      setBurst(value => value + 1);
      setNotice("Votre post a été publié sur toutes les pages sélectionnées !");
    } else { setNotice(`${publication.published} publication(s) réussie(s), ${publication.failed} en échec ou annulée(s). Consultez le détail dans le calendrier.`); }
    setPendingPublication(null);
  }, [publication]);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [target, setTarget] = useState<SocialTarget | null>(null);
  const cancel = useMutation(api.socialComposer.cancel);
  const entries = useQuery(api.socialComposer.list, {
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }).getTime(),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }).getTime() + 1,
  });
  const detail = entries?.find(entry => entry.id === selected);
  // Pages proposées au filtre : celles qui publient ce mois-ci, plus celle déjà
  // sélectionnée — sans quoi le filtre perdrait sa valeur en changeant de mois.
  const targets: SocialTarget[] = [...new Map([
    ...(entries ?? []).map(entry => [entry.targetId, { id: entry.targetId, name: entry.targetName, network: entry.network }] as const),
    ...(target ? [[target.id, target] as const] : []),
  ]).values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const visible = (entries ?? []).filter(entry => !target || entry.targetId === target.id);
  const history = visible.filter(entry => entry.date >= startOfMonth(month).getTime() && entry.date < startOfMonth(addMonths(month, 1)).getTime());
  return <div className="space-y-6">
    <PublicationConfetti burst={burst} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">Publications sur les réseaux</h2><p className="mt-1 text-sm text-[var(--muted-foreground)]">Facebook et Instagram · calendrier et historique</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={async () => {
        setRefreshing(true); setAwaitingSync(true); setSyncError("");
        try { await refresh({}); } catch { setSyncError("Impossible de joindre les réseaux. Les publications sont conservées."); } finally { setRefreshing(false); }
      }}><RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />Actualiser</Button>
      {canPublish && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Nouveau post</Button>}</div>
    </div>
    <div className="space-y-1 text-xs text-[var(--muted-foreground)]">
      {/* Les points de suspension ne s'affichent que pour un passage demandé
          ici : une synchronisation de fond (ouverture de page, autre
          utilisateur) n'a pas à faire mouliner l'écran de tout le monde. */}
      <p>{busy ? "Synchronisation avec les réseaux…" : syncStatus?.finishedAt ? `Dernière synchronisation : ${dateLabel(syncStatus.finishedAt)}${running ? " · un autre passage est en cours" : ""}` : "Les publications se synchronisent en arrière-plan."}</p>
      {(syncError || Boolean(syncStatus?.errors.length)) && <p role="alert" className="text-amber-700">{syncError || syncStatus?.errors.join(" ")}</p>}
    </div>
    {notice && <p role="status" className="rounded-xl bg-brand-500/10 p-3 text-sm">{notice}</p>}
    <CalendarBoard month={month} onMonthChange={date => setMonth(date.getTime())} events={visible.filter(entry => entry.status !== "cancelled").map(entry => ({ id: entry.id, start: entry.date, title: `${entry.targetName} · ${statuses[entry.status]}`, subtitle: entry.message, tone: entry.status === "failed" ? "rose" : entry.status === "scheduled" ? "amber" : "brand" }))} onEventClick={id => { setSelected(id); setError(""); }} />
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Historique et programmations · {new Date(month).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })}</h3>
        <SocialTargetFilter targets={targets} value={target?.id ?? ALL_TARGETS} onChange={id => setTarget(targets.find(item => item.id === id) ?? null)} />
      </div>
      {entries === undefined ? <p role="status">Chargement des publications…</p> : history.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">{target ? `Aucune publication de ${target.name} ce mois-ci.` : "Aucune publication ce mois-ci."} Parcourez le calendrier pour consulter les autres mois.</p> : <div className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
        {history?.map(entry => <button key={entry.id} onClick={() => { setSelected(entry.id); setError(""); }} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-[var(--accent)]">
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{entry.network === "facebook" ? "Facebook" : "Instagram"} · {entry.targetName}</p><p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">{entry.message || "Publication photo"}</p><p className="mt-1 text-xs text-[var(--muted-foreground)]">{dateLabel(entry.date)} · {entry.authorName}</p></div>
          <span className={cn("rounded-full px-3 py-1 text-xs font-medium", entry.status === "failed" ? "bg-red-100 text-red-800" : entry.status === "scheduled" ? "bg-amber-100 text-amber-900" : "bg-[var(--accent)]")}>{statuses[entry.status]}</span>
        </button>)}
      </div>}
    </section>
    {creating && <SocialComposer canCreate={canCreate} onClose={() => setCreating(false)} onCreated={(id, scheduled) => { setPendingPublication(id); setCreating(false); if (scheduled) setMonth(startOfMonth(scheduled).getTime()); setNotice(scheduled ? "Publication programmée. Retrouvez le suivi de chaque page dans le calendrier." : "Publication enregistrée. Les envois sont en cours et leur résultat apparaît ci-dessous."); }} />}
    <Modal open={Boolean(detail)} onClose={() => setSelected(null)} title="Détail de la publication">
      {detail && <div className="space-y-4">
        <p className="font-semibold">{detail.network === "facebook" ? "Facebook" : "Instagram"} · {detail.targetName}</p>
        <p className="text-sm">{statuses[detail.status]} · {dateLabel(detail.date)} · {detail.authorName}</p>
        {detail.status === "published" ? <PublishedPostEmbed key={detail.id} id={detail.id} /> : <p className="whitespace-pre-wrap">{detail.message || "Publication photo"}</p>}
        {detail.mesoutils && <p className="text-sm text-brand-700">Également publié sur Mes Outils.</p>}
        {detail.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{detail.error}</p>}
        {canPublish && detail.network === "facebook" && detail.status === "published" && <FacebookPostActions
          key={detail.id}
          id={detail.id}
          message={detail.message}
          onDeleted={() => { setSelected(null); setNotice("Publication supprimée de Facebook."); }}
          onUpdated={() => setNotice("Texte modifié sur Facebook.")}
        />}
        {canPublish && detail.deliveryId && detail.status === "scheduled" && <Button disabled={cancelling} variant="secondary" onClick={async () => {
          setCancelling(true); setError("");
          try { await cancel({ id: detail.deliveryId! }); } catch (err) { setError(err instanceof Error ? err.message : "Annulation impossible."); } finally { setCancelling(false); }
        }}>Annuler cette programmation</Button>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>}
    </Modal>
  </div>;
}

/**
 * Gestion d'un post Facebook déjà en ligne. Facebook n'accepte de réécrire que
 * le texte : les photos d'un post publié ne peuvent plus changer.
 */
function FacebookPostActions({ id, message, onDeleted, onUpdated }: { id: string; message: string; onDeleted: () => void; onUpdated: () => void }) {
  const updatePost = useAction(api.socialManage.updatePost);
  const deletePost = useAction(api.socialManage.deletePost);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-3 border-t border-[var(--border)] pt-4">
    {editing ? <>
      <Field label="Texte de la publication" hint="Les photos d'un post déjà publié ne peuvent pas être remplacées.">
        <Textarea rows={6} value={draft} onChange={event => setDraft(event.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !draft.trim() || draft === message} onClick={async () => {
          setBusy(true); setError("");
          try { await updatePost({ id, message: draft }); setEditing(false); onUpdated(); }
          catch (err) { setError(err instanceof Error ? err.message : "Modification impossible."); }
          finally { setBusy(false); }
        }}>{busy ? "Enregistrement…" : "Enregistrer sur Facebook"}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setEditing(false); setDraft(message); setError(""); }}>Annuler</Button>
      </div>
    </> : <div className="flex flex-wrap gap-2">
      <Button variant="secondary" disabled={busy} onClick={() => { setDraft(message); setError(""); setEditing(true); }}><Pencil className="h-4 w-4" />Modifier le texte</Button>
      <Button variant="danger" disabled={busy} onClick={async () => {
        if (!(await confirmPermanentDelete("Supprimer définitivement cette publication de Facebook ? Elle disparaîtra aussi de Mes Outils."))) return;
        setBusy(true); setError("");
        try { await deletePost({ id }); onDeleted(); }
        catch (err) { setError(err instanceof Error ? err.message : "Suppression impossible."); setBusy(false); }
      }}><Trash2 className="h-4 w-4" />{busy ? "Suppression…" : "Supprimer de Facebook"}</Button>
    </div>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </div>;
}

function Choice({ selected, children, onClick, disabled = false }: { selected: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={cn("inline-flex items-center justify-center gap-2.5 rounded-xl border px-5 py-3 text-sm font-medium transition disabled:opacity-40", selected ? "border-brand-500 bg-brand-500/10 text-brand-700" : "border-[var(--border)] hover:bg-[var(--accent)]")}>{children}</button>;
}

function SocialComposer({ canCreate, onClose, onCreated }: { canCreate: boolean; onClose: () => void; onCreated: (id: Id<"socialCompositions">, date?: number) => void }) {
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
  const selectedPages = facebook ? (pages ?? []).filter(page => facebookIds.includes(page.pageId)) : [];
  const selectedAccounts = instagram ? (accounts ?? []).filter(account => instagramIds.includes(account.instagramId)) : [];
  const photoUrls = previews.filter(photo => images.includes(photo.storageId)).map(photo => photo.previewUrl);
  const validTargets = (facebook || instagram) && (!facebook || selectedPages.length > 0) && (!instagram || selectedAccounts.length > 0);
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
  return <Modal open onClose={() => { if (!busy) onClose(); }} title="Nouveau post sur les réseaux"
    className="sm:h-[94vh] sm:w-[96vw] sm:max-w-[96vw]"
    headerContent={<ol aria-label="Étapes de publication" className="mx-auto flex max-w-6xl gap-2 text-sm">
      {["Réseaux et pages", "Votre post", "Mes Outils"].map((label, index) => <li key={label} className="min-w-0 flex-1">
        <button
          type="button"
          aria-current={step === index ? "step" : undefined}
          disabled={index >= step || busy}
          onClick={() => {
            if (index < step && !busy) {
              setError("");
              setStep(index);
            }
          }}
          className={cn("w-full rounded-full px-3 py-2 text-center transition-colors disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2", step === index ? "bg-brand-500 text-white" : "bg-[var(--accent)]", index < step && !busy && "cursor-pointer hover:bg-brand-100 hover:text-brand-700")}
        >{index + 1}. {label}</button>
      </li>)}
    </ol>}
  >
    <div className="mx-auto max-w-6xl space-y-6">
      {step === 0 && <div className="space-y-5">
        <h3 className="text-lg font-semibold">Où souhaitez-vous publier ?</h3>
        <div className="flex gap-3"><Choice selected={facebook} onClick={() => { setFacebook(!facebook); if (facebook) setFacebookIds([]); }}><FacebookIcon className="h-6 w-6" />Facebook</Choice><Choice selected={instagram} onClick={() => { setInstagram(!instagram); if (instagram) setInstagramIds([]); }}><InstagramIcon className="h-6 w-6" />Instagram</Choice></div>
        {facebook && <section className="space-y-3"><h4 className="flex items-center gap-2 font-medium"><FacebookIcon className="h-5 w-5" />Pages Facebook</h4>{pages === undefined ? <p>Chargement…</p> : !pages.length ? <p>Aucune page Facebook connectée.</p> : <FacebookPageMultiSelect pages={pages} value={selectedPages.map(page => page.pageId)} onChange={setFacebookIds} />}</section>}
        {instagram && <section className="space-y-3"><h4 className="flex items-center gap-2 font-medium"><InstagramIcon className="h-5 w-5" />Pages avec un compte Instagram</h4>{accounts === undefined ? <p>Chargement…</p> : !accounts.length ? <p className="text-sm text-[var(--muted-foreground)]">Aucune page avec un compte Instagram connecté.</p> : <FacebookPageMultiSelect network="instagram" pages={accounts.map(account => ({ pageId: account.instagramId, name: `${account.pageName} · @${account.username}` }))} value={selectedAccounts.map(account => account.instagramId)} onChange={setInstagramIds} />}</section>}

      </div>}
      <div className={step > 0 ? "grid items-start gap-8 lg:grid-cols-2" : ""}>
      <div className="min-w-0 space-y-5" hidden={step === 0}>
      <div hidden={step !== 1} className="space-y-5">
        {step === 1 && <SocialAiAssistant networks={[...(facebook ? ["facebook" as const] : []), ...(instagram ? ["instagram" as const] : [])]} pageNames={[...selectedPages.map(page => page.name), ...selectedAccounts.map(account => account.pageName)]} onApply={setMessage} />}
        <Field label="Texte du post"><Textarea aria-label="Texte du post" rows={7} value={message} maxLength={instagram ? 2200 : 63206} onChange={event => setMessage(event.target.value)} placeholder="Que souhaitez-vous partager ?" /></Field>
        <div><p className="mb-2 text-sm font-medium">Photos · 10 maximum{instagram ? " · JPEG pour Instagram" : ""}</p><PhotoUpload jpeg value={images} onChange={setImages} onUploadingChange={setUploading} onPreviewsChange={setPreviews} /></div>
        <div className="flex flex-wrap gap-3"><Choice selected={!scheduled} onClick={() => setScheduled(false)}>Publier maintenant</Choice><Choice selected={scheduled} onClick={() => setScheduled(true)}>Programmer</Choice></div>
        {scheduled && <Field label="Date et heure de publication sur les réseaux"><DateTimePicker value={date} onChange={setDate} /></Field>}
      </div>
      {step === 2 && <div className="space-y-5">
        <div className="rounded-2xl bg-[var(--accent)] p-4"><p className="text-sm font-medium">{facebook ? `${selectedPages.length} page(s) Facebook` : ""}{facebook && instagram ? " · " : ""}{instagram ? `${selectedAccounts.length} compte(s) Instagram` : ""}</p><p className="mt-1 text-sm">{scheduled && date ? `Programmation : ${dateLabel(date)}` : "Publication immédiate sur les réseaux"}</p><p className="mt-3 whitespace-pre-wrap text-sm">{message || "Publication photo"}</p><p className="mt-2 text-xs">{images.length} photo(s)</p></div>
        <div className="flex flex-wrap gap-2">{previews.map(photo => <img key={photo.storageId} src={photo.previewUrl} alt="Photo du post" className="h-24 w-24 rounded-xl object-cover" />)}</div>
        <h3 className="text-lg font-semibold">Souhaitez-vous publier ce post sur Mes Outils ?</h3>
        <div className="flex gap-3"><Choice selected={mesoutils === true} disabled={!canCreate} onClick={() => setMesoutils(true)}>Oui</Choice><Choice selected={mesoutils === false} onClick={() => setMesoutils(false)}>Non</Choice></div>
        <p className="text-sm text-[var(--muted-foreground)]">{canCreate ? "Si vous choisissez Oui, le post et ses photos apparaîtront immédiatement dans les Posts de Mes Outils, même si les réseaux sont programmés pour plus tard." : "Votre accès ne permet pas de créer un post sur Mes Outils. Vous pouvez publier sur les réseaux en choisissant Non."}</p>
      </div>}
      </div>
      {step > 0 && <aside className="min-w-0 space-y-5" aria-label="Aperçus des publications">
        <h3 className="text-lg font-semibold">Aperçu des posts</h3>
        {selectedPages.map(page => <section key={page.pageId} className="space-y-2"><h4 className="flex items-center gap-2 text-sm font-medium"><FacebookIcon className="h-5 w-5" />Facebook · {page.name}</h4><FacebookPostPreview accountName={page.name} accountImageUrl={page.profileImageUrl} message={message} photoUrls={photoUrls} scheduledFor={scheduled ? date : undefined} /></section>)}
        {selectedAccounts.map(account => <section key={account.instagramId} className="space-y-2"><h4 className="flex items-center gap-2 text-sm font-medium"><InstagramIcon className="h-5 w-5" />Instagram · @{account.username}</h4><InstagramPostPreview accountName={account.username} accountImageUrl={account.profileImageUrl} caption={message} photoUrls={photoUrls} /></section>)}
      </aside>}
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <div className="flex justify-between border-t border-[var(--border)] pt-4">
        <Button variant="secondary" disabled={busy} onClick={() => step ? setStep(step - 1) : onClose()}>{step ? "Retour" : "Annuler"}</Button>
        {step < 2 ? <Button disabled={uploading} onClick={next}>{uploading ? "Photos en cours…" : "Continuer"}</Button> : <Button disabled={busy || mesoutils === null || !validTargets} onClick={async () => {
          setBusy(true); setError("");
          try {
            const id = await create({ requestKey, message, images, facebookIds: selectedPages.map(page => page.pageId), instagramIds: selectedAccounts.map(account => account.instagramId), scheduledFor: scheduled ? date ?? undefined : undefined, publishOnMesoutils: mesoutils === true });
            onCreated(id, scheduled ? date ?? undefined : undefined);
          } catch (err) { setError(err instanceof Error ? err.message : "Impossible d'enregistrer la publication."); } finally { setBusy(false); }
        }}>{busy ? "Enregistrement…" : scheduled ? "Confirmer la programmation" : "Publier"}</Button>}
      </div>
    </div>
  </Modal>;
}
