import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  CalendarPlus,
  Image as ImageIcon,
  MapPin,
  MessageCircle,
  MessagesSquare,
  PartyPopper,
  Pin,
  PinOff,
  Plus,
  Send,
  Tag,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSearchParams } from "react-router-dom";
import { SectionHeader } from "../components/SectionHeader";
import { SectionTabs } from "../components/ui/SectionTabs";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { DateRangePicker } from "../components/ui/DateRangePicker";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { PhotoUpload } from "../components/ui/PhotoUpload";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDate, formatDateTime, formatRelative } from "../lib/format";
import { canAccess } from "../lib/permissions";
import { cn } from "../lib/cn";

const DEAL_TYPES = [
  { key: "pret", label: "Prêt" },
  { key: "don", label: "Don" },
  { key: "vente", label: "Vente" },
  { key: "echange", label: "Échange" },
] as const;
type DealType = (typeof DEAL_TYPES)[number]["key"];

export function Actualites() {
  const access = usePermissionsAccess();
  const [searchParams] = useSearchParams();
  const sub = searchParams.get("v") ?? "publications";
  const canCreate = canAccess(access, "mesoutils:actualites", "create");
  const canManage = canAccess(access, "mesoutils:actualites", "manage");

  return (
    <div className="space-y-6">
      <SectionHeader title="Espace partage" subtitle="Le fil interne de l'équipe" />
      <SectionTabs />
      {sub === "publications" ? <Publications canCreate={canCreate} canManage={canManage} /> : null}
      {sub === "evenements" ? <Evenements canCreate={canCreate} /> : null}
      {sub === "bonsplans" ? <BonsPlans canCreate={canCreate} /> : null}
    </div>
  );
}

/* ─── Publications ───────────────────────────────────────────────────────── */

type Comment = { _id: Id<"postComments">; authorName: string; authorImageUrl?: string; body: string; createdAt: number; canRemove?: boolean };
type Post = {
  _id: Id<"posts">;
  authorName: string;
  authorImageUrl?: string;
  body?: string;
  createdAt: number;
  pinned?: boolean;
  imageUrls: string[];
  likedByMe: boolean;
  likesCount: number;
  commentsCount: number;
  comments: Comment[];
};

function Publications({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const { user } = useUser();
  const access = usePermissionsAccess();
  const posts = useQuery(api.posts.list, { limit: 60 }) as Post[] | undefined;
  const createPost = useMutation(api.posts.create);
  const addComment = useMutation(api.posts.addComment);
  const removeComment = useMutation(api.posts.removeComment);
  const toggleLike = useMutation(api.posts.toggleLike);
  const removePost = useMutation(api.posts.remove);
  const pinPost = useMutation(api.posts.pin);

  const [body, setBody] = useState("");
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [showPhoto, setShowPhoto] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!body.trim() && images.length === 0) return;
    setSubmitting(true);
    try {
      await createPost({ body, images });
      setBody("");
      setImages([]);
      setShowPhoto(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (posts === undefined) return <FullSpinner label="Chargement..." />;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {canCreate ? (
        <section className="premium-panel rounded-2xl p-4">
          <div className="flex gap-3">
            <Avatar name={user?.fullName ?? "Moi"} src={user?.imageUrl} />
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Quoi de neuf ?"
              className="min-h-[52px] w-full resize-none rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-brand-500/30"
              rows={body ? 3 : 1}
            />
          </div>
          {showPhoto ? <PhotoUpload value={images} onChange={setImages} className="mt-3 pl-[60px]" /> : null}
          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => setShowPhoto((current) => !current)}
              className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition", showPhoto ? "bg-brand-50 text-brand-700" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]")}
            >
              <ImageIcon className="h-4 w-4" /> Photo
            </button>
            <Button onClick={submit} disabled={submitting || (!body.trim() && images.length === 0)}>
              <Send className="h-4 w-4" /> {submitting ? "Publication..." : "Publier"}
            </Button>
          </div>
        </section>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState icon={<MessageCircle className="h-8 w-8" />} title="Aucune publication" description="Le premier post de l'équipe apparaîtra ici." />
      ) : (
        posts.map((post) => (
          <PostCard
            key={post._id}
            post={post}
            currentName={user?.fullName ?? access?.email ?? "Moi"}
            currentImage={user?.imageUrl}
            canManage={canManage}
            canCreate={canCreate}
            onToggleLike={() => toggleLike({ postId: post._id })}
            onPin={() => pinPost({ postId: post._id, pinned: !post.pinned })}
            onRemove={() => removePost({ postId: post._id })}
            onAddComment={(text) => addComment({ postId: post._id, body: text })}
            onRemoveComment={(commentId) => removeComment({ commentId })}
          />
        ))
      )}
    </div>
  );
}

function PostCard({
  post, currentName, currentImage, canManage, canCreate, onToggleLike, onPin, onRemove, onAddComment, onRemoveComment,
}: {
  post: Post; currentName: string; currentImage?: string; canManage: boolean; canCreate: boolean;
  onToggleLike: () => void; onPin: () => void; onRemove: () => void;
  onAddComment: (text: string) => Promise<unknown>; onRemoveComment: (commentId: Id<"postComments">) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState("");

  async function submitComment() {
    const text = draft.trim();
    if (!text) return;
    await onAddComment(text);
    setDraft("");
    setShowComments(true);
  }

  return (
    <article className="premium-panel animate-enter overflow-hidden rounded-2xl">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 gap-3">
          <Avatar name={post.authorName} src={post.authorImageUrl} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold text-[var(--foreground)]">{post.authorName}</h2>
              {post.pinned ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-800">
                  <Pin className="h-3 w-3" /> Épinglé
                </span>
              ) : null}
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">{formatRelative(post.createdAt)}</p>
          </div>
        </div>
        {canManage ? (
          <div className="flex items-center gap-1">
            <button type="button" onClick={onPin} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]">
              {post.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
            <button type="button" onClick={onRemove} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>

      {post.body ? <p className="whitespace-pre-wrap px-4 pb-3 text-[15px] leading-7 text-[var(--foreground)]">{post.body}</p> : null}

      {post.imageUrls.length > 0 ? (
        <div className={`grid gap-0.5 ${post.imageUrls.length === 1 ? "" : "grid-cols-2"}`}>
          {post.imageUrls.map((url) => <img key={url} src={url} alt="" className="max-h-[480px] w-full object-cover" />)}
        </div>
      ) : null}

      {post.likesCount > 0 || post.commentsCount > 0 ? (
        <div className="flex items-center justify-between px-4 py-2.5 text-sm text-[var(--muted-foreground)]">
          <span className="inline-flex items-center gap-1.5">
            {post.likesCount > 0 ? (
              <>
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white"><ThumbsUp className="h-3 w-3 fill-current" /></span>
                {post.likesCount}
              </>
            ) : null}
          </span>
          {post.commentsCount > 0 ? (
            <button type="button" onClick={() => setShowComments((c) => !c)} className="hover:underline">
              {post.commentsCount} commentaire{post.commentsCount > 1 ? "s" : ""}
            </button>
          ) : null}
        </div>
      ) : null}

      {canCreate ? (
        <div className="mx-2 grid grid-cols-2 border-t border-[var(--border)]">
          <SocialButton active={post.likedByMe} onClick={onToggleLike}>
            <ThumbsUp className={`h-[18px] w-[18px] ${post.likedByMe ? "fill-current" : ""}`} /> J'aime
          </SocialButton>
          <SocialButton onClick={() => setShowComments((c) => !c)}>
            <MessageCircle className="h-[18px] w-[18px]" /> Commenter
          </SocialButton>
        </div>
      ) : (
        <div className="mx-2 border-t border-[var(--border)]">
          <SocialButton onClick={() => setShowComments((c) => !c)}>
            <MessageCircle className="h-[18px] w-[18px]" /> {showComments ? "Masquer les commentaires" : "Voir les commentaires"}
          </SocialButton>
        </div>
      )}

      {showComments ? (
        <div className="space-y-3 border-t border-[var(--border)] bg-[var(--accent)] p-4">
          {post.comments.map((comment) => (
            <div key={comment._id} className="flex gap-2.5">
              <Avatar name={comment.authorName} src={comment.authorImageUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="inline-block rounded-2xl bg-[var(--card)] px-3.5 py-2">
                  <p className="text-sm font-semibold text-[var(--foreground)]">{comment.authorName}</p>
                  <p className="text-sm leading-6 text-[var(--foreground)]">{comment.body}</p>
                </div>
                <div className="mt-1 flex items-center gap-3 pl-2 text-xs text-[var(--muted-foreground)]">
                  <span>{formatRelative(comment.createdAt)}</span>
                  {comment.canRemove || canManage ? (
                    <button type="button" onClick={() => onRemoveComment(comment._id)} className="font-semibold hover:text-red-600">Supprimer</button>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
          {canCreate ? (
            <div className="flex gap-2.5">
              <Avatar name={currentName} src={currentImage} size="sm" />
              <div className="flex flex-1 gap-2">
                <Input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitComment(); } }}
                  placeholder="Écrire un commentaire..."
                  className="rounded-full bg-[var(--card)]"
                />
                <Button onClick={submitComment} disabled={!draft.trim()}><Send className="h-4 w-4" /></Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/* ─── Événements ─────────────────────────────────────────────────────────── */

type EventItem = {
  _id: Id<"events">;
  authorName: string;
  title: string;
  description?: string;
  location?: string;
  start: number;
  end?: number;
  imageUrls: string[];
  canManage: boolean;
};

function Evenements({ canCreate }: { canCreate: boolean }) {
  const events = useQuery(api.community.listEvents) as EventItem[] | undefined;
  const createEvent = useMutation(api.community.createEvent);
  const removeEvent = useMutation(api.community.removeEvent);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", location: "", start: null as number | null, end: null as number | null });
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.title.trim() || !form.start) return;
    setSaving(true);
    try {
      await createEvent({
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        start: form.start,
        end: form.end ?? undefined,
        images,
      });
      setForm({ title: "", description: "", location: "", start: null, end: null });
      setImages([]);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (events === undefined) return <FullSpinner label="Chargement..." />;

  return (
    <div className="space-y-5">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}><CalendarPlus className="h-4 w-4" /> Nouvel événement</Button>
        </div>
      ) : null}

      {events.length === 0 ? (
        <EmptyState icon={<PartyPopper className="h-8 w-8" />} title="Aucun événement" description="Les événements internes apparaîtront ici." />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => (
            <article key={event._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
              {event.imageUrls[0] ? (
                <img src={event.imageUrls[0]} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-brand-50"><PartyPopper className="h-10 w-10 text-brand-500" /></div>
              )}
              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-600">{formatDate(event.start)}</p>
                <h3 className="mt-1 text-lg font-bold text-[var(--foreground)]">{event.title}</h3>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {formatDateTime(event.start)}{event.end ? ` → ${formatDateTime(event.end)}` : ""}
                </p>
                {event.location ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--foreground)]"><MapPin className="h-4 w-4 text-brand-600" />{event.location}</p>
                ) : null}
                {event.description ? <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{event.description}</p> : null}
                <p className="mt-3 text-xs text-[var(--muted-foreground)]">Proposé par {event.authorName}</p>
                {event.canManage ? (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => removeEvent({ eventId: event._id })}>
                    <Trash2 className="h-4 w-4" /> Supprimer
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvel événement">
        <div className="grid gap-4">
          <Field label="Titre" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Lieu"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Période" required>
            <DateRangePicker
              value={{ start: form.start, end: form.end }}
              onChange={(range) => setForm({ ...form, start: range.start, end: range.end })}
              placeholder="Date et horaires"
            />
          </Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Photos"><PhotoUpload value={images} onChange={setImages} /></Field>
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving || !form.title.trim() || !form.start}>
              <Plus className="h-4 w-4" /> {saving ? "Création..." : "Créer"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ─── Bons plans ─────────────────────────────────────────────────────────── */

type Deal = {
  _id: Id<"dealPosts">;
  authorClerkId: string;
  authorName: string;
  title: string;
  description: string;
  dealType: DealType;
  price?: number;
  availableFrom?: number;
  availableTo?: number;
  imageUrls: string[];
  status: "open" | "closed";
  canManage: boolean;
  isMine: boolean;
};

/** Lien vers la messagerie pré-remplie façon "leboncoin" pour un bon plan. */
function contactDealHref(deal: Deal) {
  const priceLabel = deal.dealType === "vente" && deal.price ? ` (${deal.price} €)` : "";
  const prefill = `Bonjour, je suis intéressé(e) par votre annonce « ${deal.title} »${priceLabel}. Est-elle toujours disponible ?`;
  const params = new URLSearchParams({
    to: deal.authorClerkId,
    name: deal.authorName,
    prefill,
    ctxTitle: deal.title,
  });
  if (deal.imageUrls[0]) params.set("ctxImage", deal.imageUrls[0]);
  const typeLabel = DEAL_TYPES.find((t) => t.key === deal.dealType)?.label;
  if (typeLabel) params.set("ctxType", typeLabel);
  if (deal.dealType === "vente" && deal.price) params.set("ctxPrice", String(deal.price));
  return `/messagerie?${params.toString()}`;
}

const DEAL_BADGE: Record<DealType, string> = {
  pret: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
  don: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200",
  vente: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  echange: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
};

function BonsPlans({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate();
  const deals = useQuery(api.community.listDeals) as Deal[] | undefined;
  const createDeal = useMutation(api.community.createDeal);
  const removeDeal = useMutation(api.community.removeDeal);
  const setStatus = useMutation(api.community.setDealStatus);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", dealType: "pret" as DealType, price: "", from: null as number | null, to: null as number | null });
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      await createDeal({
        title: form.title,
        description: form.description,
        dealType: form.dealType,
        price: form.dealType === "vente" && form.price ? Number(form.price) : undefined,
        availableFrom: form.from ?? undefined,
        availableTo: form.to ?? undefined,
        images,
      });
      setForm({ title: "", description: "", dealType: "pret", price: "", from: null, to: null });
      setImages([]);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (deals === undefined) return <FullSpinner label="Chargement..." />;

  return (
    <div className="space-y-5">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Proposer un bon plan</Button>
        </div>
      ) : null}

      {deals.length === 0 ? (
        <EmptyState icon={<Tag className="h-8 w-8" />} title="Aucun bon plan" description="Prêt, don, vente ou échange entre collègues : proposez le premier." />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {deals.map((deal) => (
            <article key={deal._id} className={cn("overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm", deal.status === "closed" && "opacity-60")}>
              {deal.imageUrls[0] ? (
                <img src={deal.imageUrls[0]} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-[var(--muted)]"><Tag className="h-10 w-10 text-[var(--muted-foreground)]" /></div>
              )}
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", DEAL_BADGE[deal.dealType])}>
                    {DEAL_TYPES.find((t) => t.key === deal.dealType)?.label}
                  </span>
                  {deal.dealType === "vente" && deal.price ? (
                    <span className="text-sm font-bold text-[var(--foreground)]">{deal.price} €</span>
                  ) : null}
                </div>
                <h3 className="mt-2 text-lg font-bold text-[var(--foreground)]">{deal.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{deal.description}</p>
                {deal.availableFrom ? (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    Dispo {formatDate(deal.availableFrom)}{deal.availableTo ? ` → ${formatDate(deal.availableTo)}` : ""}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">Par {deal.authorName}</p>
                <div className="mt-3 flex gap-2">
                  {deal.isMine ? (
                    <>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setStatus({ dealId: deal._id, status: deal.status === "open" ? "closed" : "open" })}>
                        {deal.status === "open" ? "Clôturer" : "Rouvrir"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removeDeal({ dealId: deal._id })}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <Button size="sm" className="flex-1" onClick={() => navigate(contactDealHref(deal))}>
                      <MessagesSquare className="h-4 w-4" /> Contacter
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Proposer un bon plan">
        <div className="grid gap-4">
          <Field label="Titre" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Tronçonneuse à prêter" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              <Select value={form.dealType} onChange={(e) => setForm({ ...form, dealType: e.target.value as DealType })}>
                {DEAL_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
              </Select>
            </Field>
            {form.dealType === "vente" ? (
              <Field label="Prix (€)"><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            ) : <div />}
          </div>
          <Field label="Description" required><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="État, conditions, détails..." /></Field>
          <Field label="Disponibilité">
            <DateRangePicker
              value={{ start: form.from, end: form.to }}
              onChange={(range) => setForm({ ...form, from: range.start, to: range.end })}
              placeholder="Optionnel"
            />
          </Field>
          <Field label="Photos"><PhotoUpload value={images} onChange={setImages} /></Field>
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving || !form.title.trim() || !form.description.trim()}>
              <Plus className="h-4 w-4" /> {saving ? "Publication..." : "Publier"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ─── Communs ────────────────────────────────────────────────────────────── */

function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "sm" | "md" }) {
  const classes = size === "sm" ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm";
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-600 font-semibold text-white ${classes}`}>
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function SocialButton({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`m-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition hover:bg-[var(--accent)] ${active ? "text-brand-600" : "text-[var(--muted-foreground)]"}`}
    >
      {children}
    </button>
  );
}
