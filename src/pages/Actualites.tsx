import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  CalendarPlus,
  Check,
  CircleHelp,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  MapPin,
  Mail,
  Loader2,
  MessageCircle,
  MessagesSquare,
  PartyPopper,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Send,
  Sparkles,
  Tag,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useSearchParams } from "react-router-dom";
import { FacebookIcon } from "../components/icons/FacebookIcon";
import { InstagramIcon } from "../components/icons/InstagramIcon";
import { SectionHeader } from "../components/SectionHeader";
import { SectionTabs } from "../components/ui/SectionTabs";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { CalendarBoard } from "../components/ui/CalendarBoard";
import { DateRangePicker } from "../components/ui/DateRangePicker";
import { DateTimePicker } from "../components/ui/DateTimePicker";
import { AttachmentUpload, type Attachment } from "../components/ui/AttachmentUpload";
import {
  EVENT_OPTION_LABELS,
  EventOptionSelect,
  type EventOptionField,
} from "../components/EventOptionSelect";
import { EventWorkerPicker } from "../components/EventWorkerPicker";
import { EmptyState } from "../components/ui/EmptyState";
import { Checkbox } from "../components/ui/Checkbox";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { Modal } from "../components/ui/Modal";
import { MediaUpload } from "../components/ui/MediaUpload";
import { PhotoUpload } from "../components/ui/PhotoUpload";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDate, formatDateTime, formatRelative } from "../lib/format";
import { canAccess } from "../lib/permissions";
import { cn } from "../lib/cn";
import { confirmPermanentDelete } from "../lib/confirm";

const DEAL_TYPES = [
  { key: "pret", label: "Prêt" },
  { key: "don", label: "Don" },
  { key: "vente", label: "Vente" },
  { key: "echange", label: "Échange" },
  { key: "location", label: "Location" },
] as const;
type DealType = (typeof DEAL_TYPES)[number]["key"];
type DealAdKind = "offre" | "demande";

/** Unités de facturation d'une location : le prix s'entend « par période ». */
const RENTAL_PERIODS = [
  { key: "jour", label: "À la journée", suffix: "/jour" },
  { key: "semaine", label: "À la semaine", suffix: "/semaine" },
  { key: "mois", label: "Au mois", suffix: "/mois" },
  { key: "annee", label: "À l'année", suffix: "/année" },
] as const;
type RentalPeriod = (typeof RENTAL_PERIODS)[number]["key"];

/** Prix affiché : « 9€/jour » pour une location, « 9 € » sinon. */
function dealPriceLabel(deal: { price?: number | null; dealType: DealType; rentalPeriod?: RentalPeriod | null }) {
  if (deal.price == null) return null;
  if (deal.dealType !== "location") return `${deal.price} €`;
  // Location : format collé « 9€/jour », la périodicité fait corps avec le prix.
  const suffix = RENTAL_PERIODS.find((p) => p.key === deal.rentalPeriod)?.suffix ?? "";
  return `${deal.price}€${suffix}`;
}

export function Actualites() {
  const access = usePermissionsAccess();
  const [searchParams] = useSearchParams();
  const sub = searchParams.get("v") ?? "publications";
  const canCreate = canAccess(access, "mesoutils:actualites", "create");
  const canManage = canAccess(access, "mesoutils:actualites", "manage");
  const canPublish = canAccess(access, "mesoutils:actualites", "publish");

  return (
    <div className="space-y-6">
      <SectionHeader title="Espace partage" />
      <SectionTabs />
      {sub === "publications" ? <Publications canCreate={canCreate} canManage={canManage} /> : null}
      {sub === "evenements" ? (
        <Evenements canCreate={canCreate} canPublish={canPublish} />
      ) : null}
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
  title?: string;
  body?: string;
  externalLink?: string;
  images: Id<"_storage">[];
  createdAt: number;
  editedAt?: number;
  pinned?: boolean;
  imageUrls: string[];
  videoUrls: string[];
  likedByMe: boolean;
  likesCount: number;
  latestLikeName?: string;
  commentsCount: number;
  comments: Comment[];
  canManage: boolean;
  canEmail: boolean;
};
type PostMedia = { kind: "image" | "video"; url: string };
type PostLike = { _id: Id<"postLikes">; name: string; imageUrl?: string; createdAt: number };

function Publications({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const { user } = useUser();
  const posts = useQuery(api.posts.list, { limit: 60 }) as Post[] | undefined;
  const createPost = useMutation(api.posts.create);
  const addComment = useMutation(api.posts.addComment);
  const removeComment = useMutation(api.posts.removeComment);
  const toggleLike = useMutation(api.posts.toggleLike);
  const removePost = useMutation(api.posts.remove);
  const pinPost = useMutation(api.posts.pin);
  const updatePost = useMutation(api.posts.update);
  const emailPost = useAction(api.posts.emailToInternalUsers);

  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [showMedia, setShowMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Composeur replié : on ne montre que le titre tant que l'utilisateur n'a pas
  // manifesté l'intention d'écrire. Trois champs vides d'emblée donnaient
  // l'impression d'un formulaire à remplir.
  const [composerOpen, setComposerOpen] = useState(false);

  async function submit() {
    if (!title.trim() && !body.trim() && !externalLink.trim() && images.length === 0) return;
    setSubmitting(true);
    try {
      await createPost({ title, body, externalLink, images });
      setTitle("");
      setBody("");
      setExternalLink("");
      setImages([]);
      setShowMedia(false);
      setComposerOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (posts === undefined) return <FullSpinner label="Chargement..." />;

  async function removePostWithConfirmation(postId: Id<"posts">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement ce post ?"))) return;
    void removePost({ postId });
  }

  async function removeCommentWithConfirmation(commentId: Id<"postComments">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement ce commentaire ?"))) return;
    void removeComment({ commentId });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {canCreate ? (
        <section className="premium-panel rounded-2xl p-4">
          <div className="flex gap-3">
            <Avatar name={user?.fullName ?? "Moi"} src={user?.imageUrl} />
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onFocus={() => setComposerOpen(true)}
                placeholder={composerOpen ? "Titre" : "Quoi de neuf ?"}
                className="rounded-2xl bg-[var(--accent)]"
              />
              {composerOpen ? (
                <div className="animate-enter space-y-2">
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Quoi de neuf ?"
                    className="min-h-[52px] w-full resize-none rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-brand-500/30"
                    rows={body ? 3 : 2}
                  />
                  <Input
                    value={externalLink}
                    onChange={(event) => setExternalLink(event.target.value)}
                    placeholder="Lien externe (optionnel)"
                    className="rounded-2xl bg-[var(--accent)]"
                  />
                </div>
              ) : null}
            </div>
          </div>
          {composerOpen && showMedia ? (
            <MediaUpload images={images} onChange={setImages} className="mt-3 pl-[60px]" />
          ) : null}
          {composerOpen ? (
            <div className="animate-enter mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
              <button
                type="button"
                onClick={() => setShowMedia((current) => !current)}
                className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition", showMedia ? "bg-brand-50 text-brand-700" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]")}
              >
                <ImageIcon className="h-4 w-4" /> Photo
              </button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setComposerOpen(false);
                    setShowMedia(false);
                  }}
                  disabled={submitting}
                >
                  Annuler
                </Button>
                <Button onClick={submit} disabled={submitting || (!title.trim() && !body.trim() && !externalLink.trim() && images.length === 0)}>
                  <Send className="h-4 w-4" /> {submitting ? "Publication..." : "Publier"}
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState icon={<MessageCircle className="h-8 w-8" />} title="Aucune publication" description="Le premier post de l'équipe apparaîtra ici." />
      ) : (
        posts.map((post) => (
          <PostCard
            key={post._id}
            post={post}
            currentName={"Moi"}
            currentImage={user?.imageUrl}
            canManage={canManage}
            canCreate={canCreate}
            onToggleLike={() => toggleLike({ postId: post._id })}
            onPin={() => pinPost({ postId: post._id, pinned: !post.pinned })}
            onRemove={() => removePostWithConfirmation(post._id)}
            onUpdate={(next) => updatePost({ postId: post._id, ...next })}
            onEmail={() => emailPost({ postId: post._id })}
            onAddComment={(text) => addComment({ postId: post._id, body: text })}
            onRemoveComment={removeCommentWithConfirmation}
          />
        ))
      )}
    </div>
  );
}

function PostCard({
  post, currentName, currentImage, canManage, canCreate, onToggleLike, onPin, onRemove, onUpdate, onEmail, onAddComment, onRemoveComment,
}: {
  post: Post; currentName: string; currentImage?: string; canManage: boolean; canCreate: boolean;
  onToggleLike: () => void; onPin: () => void; onRemove: () => void; onUpdate: (next: { title?: string; body: string; externalLink?: string; images: Id<"_storage">[] }) => Promise<unknown>;
  onEmail: () => Promise<{ recipients: number }>;
  onAddComment: (text: string) => Promise<unknown>; onRemoveComment: (commentId: Id<"postComments">) => void;
}) {
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title ?? "");
  const [editDraft, setEditDraft] = useState(post.body ?? "");
  const [editExternalLink, setEditExternalLink] = useState(post.externalLink ?? "");
  const [editImages, setEditImages] = useState<Id<"_storage">[]>(post.images ?? []);
  const [savingEdit, setSavingEdit] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [likesOpen, setLikesOpen] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [emailStatus, setEmailStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const likes = useQuery(api.posts.listLikes, likesOpen ? { postId: post._id } : "skip") as
    | PostLike[]
    | undefined;
  const media: PostMedia[] = [
    ...post.imageUrls.map((url) => ({ kind: "image" as const, url })),
    ...post.videoUrls.map((url) => ({ kind: "video" as const, url })),
  ];

  function startEdit() {
    setEditTitle(post.title ?? "");
    setEditDraft(post.body ?? "");
    setEditExternalLink(post.externalLink ?? "");
    setEditImages(post.images ?? []);
    setEditing(true);
  }

  async function saveEdit() {
    const nextTitle = editTitle.trim();
    const text = editDraft.trim();
    const nextExternalLink = editExternalLink.trim();
    if (!nextTitle && !text && !nextExternalLink && editImages.length === 0 && post.videoUrls.length === 0) return;
    setSavingEdit(true);
    try {
      await onUpdate({
        title: nextTitle || undefined,
        body: text,
        externalLink: nextExternalLink || undefined,
        images: editImages,
      });
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  }

  async function submitComment() {
    const text = draft.trim();
    if (!text) return;
    await onAddComment(text);
    setDraft("");
    setShowComments(true);
  }

  async function sendPostByEmail() {
    setEmailStatus("sending");
    try {
      await onEmail();
      setEmailStatus("sent");
    } catch {
      setEmailStatus("error");
    }
  }

  return (
    <>
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
            <p className="text-xs text-[var(--muted-foreground)]">
              {formatRelative(post.createdAt)}{post.editedAt ? " · modifié" : ""}
            </p>
          </div>
        </div>
        {post.canManage || canManage ? (
          <div className="flex items-center gap-1">
            {post.canManage ? (
              <button type="button" onClick={startEdit} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]" title="Modifier">
                <Pencil className="h-4 w-4" />
              </button>
            ) : null}
            {canManage ? (
              <button type="button" onClick={onPin} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]">
                {post.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              </button>
            ) : null}
            {canManage ? (
              <button type="button" onClick={onRemove} className="rounded-full p-2 text-[var(--muted-foreground)] hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {editing ? (
        <div className="space-y-2 px-4 pb-3">
          <Input
            value={editTitle}
            onChange={(event) => setEditTitle(event.target.value)}
            placeholder="Titre"
            className="rounded-2xl bg-[var(--accent)]"
          />
          <textarea
            value={editDraft}
            onChange={(event) => setEditDraft(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-brand-500/30"
          />
          <Input
            value={editExternalLink}
            onChange={(event) => setEditExternalLink(event.target.value)}
            placeholder="Lien externe (optionnel)"
            className="rounded-2xl bg-[var(--accent)]"
          />
          <MediaUpload
            images={editImages}
            initialMedia={(post.images ?? []).map((id, index) => ({
              storageId: id,
              previewUrl: post.imageUrls[index] ?? "",
            }))}
            onChange={setEditImages}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={savingEdit}>
              <X className="h-4 w-4" /> Annuler
            </Button>
            <Button size="sm" onClick={saveEdit} disabled={savingEdit || (!editTitle.trim() && !editDraft.trim() && !editExternalLink.trim() && editImages.length === 0 && post.videoUrls.length === 0)}>
              {savingEdit ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </div>
      ) : post.title || post.body || post.externalLink ? (
        <div className="space-y-2 px-4 pb-3">
          {post.title ? <h3 className="text-lg font-semibold text-[var(--foreground)]">{post.title}</h3> : null}
          {post.body ? (
            <PostBody body={post.body} expanded={bodyExpanded} onExpand={() => setBodyExpanded(true)} />
          ) : null}
          {post.externalLink ? (
            <p className="break-words text-sm text-[var(--muted-foreground)]">
              Lien externe :{" "}
              <a
                href={externalHref(post.externalLink)}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
              >
                {post.externalLink}
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      {post.imageUrls.length > 0 ? (
        <div className={`grid gap-0.5 ${post.imageUrls.length === 1 ? "" : "grid-cols-2"}`}>
          {post.imageUrls.map((url, index) => (
            <button key={url} type="button" onClick={() => setViewerIndex(index)} className="block cursor-zoom-in overflow-hidden bg-black text-left">
              <img src={url} alt="" loading="lazy" decoding="async" className="max-h-[480px] w-full object-cover transition hover:opacity-95" />
            </button>
          ))}
        </div>
      ) : null}

      {post.videoUrls.length > 0 ? (
        <div className="grid gap-0.5">
          {post.videoUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setViewerIndex(post.imageUrls.length + index)}
              className="group relative block cursor-zoom-in overflow-hidden bg-black text-left"
            >
              <video src={url} muted playsInline preload="none" className="aspect-video max-h-[560px] w-full bg-black object-contain" />
              <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/65 text-white shadow-lg ring-1 ring-white/30 transition group-hover:scale-105">
                <Play className="ml-1 h-8 w-8 fill-current" />
              </span>
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 py-3 text-sm font-semibold text-white opacity-0 transition group-hover:opacity-100">
                Ouvrir la vidéo
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {post.likesCount > 0 || post.commentsCount > 0 ? (
        <div className="flex items-center justify-between px-4 py-2.5 text-sm text-[var(--muted-foreground)]">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {post.likesCount > 0 ? (
              <button
                type="button"
                onClick={() => setLikesOpen(true)}
                className="inline-flex min-w-0 items-center gap-1.5 text-left transition hover:underline"
                aria-label="Voir les personnes qui ont aimé ce post"
              >
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-white"><ThumbsUp className="h-3 w-3 fill-current" /></span>
                <span className="truncate">{likeSummary(post.latestLikeName, post.likesCount)}</span>
              </button>
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
        <div className={cn("mx-2 grid border-t border-[var(--border)]", post.canEmail ? "grid-cols-3" : "grid-cols-2")}>
          <SocialButton active={post.likedByMe} onClick={onToggleLike}>
            <ThumbsUp className={`h-[18px] w-[18px] ${post.likedByMe ? "fill-current" : ""}`} /> J'aime
          </SocialButton>
          <SocialButton onClick={() => setShowComments((c) => !c)}>
            <MessageCircle className="h-[18px] w-[18px]" /> Commenter
          </SocialButton>
          {post.canEmail ? (
            <button
              type="button"
              onClick={sendPostByEmail}
              disabled={emailStatus === "sending" || emailStatus === "sent"}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-[var(--muted-foreground)] transition hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {emailStatus === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {emailStatus === "sending" ? "Envoi..." : emailStatus === "sent" ? "Email envoyé" : "Envoyer par mail"}
            </button>
          ) : null}
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
    {viewerIndex != null ? (
      <PostMediaViewer media={media} index={viewerIndex} onIndexChange={setViewerIndex} onClose={() => setViewerIndex(null)} />
    ) : null}
    <LikesModal open={likesOpen} likes={likes} onClose={() => setLikesOpen(false)} />
    {emailStatus === "sent" ? (
      <div role="status" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-3 text-sm font-medium text-emerald-700 shadow-lg">
        <Mail className="h-5 w-5" /> Email envoyé aux utilisateurs internes.
      </div>
    ) : null}
    {emailStatus === "error" ? (
      <div role="alert" className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-700 shadow-lg">
        <Mail className="h-5 w-5" /> L'email n'a pas pu être envoyé.
      </div>
    ) : null}
    </>
  );
}

function LikesModal({
  open,
  likes,
  onClose,
}: {
  open: boolean;
  likes: PostLike[] | undefined;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Mentions J'aime">
      {likes === undefined ? (
        <FullSpinner label="Chargement des likes..." />
      ) : likes.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">
          Personne n'a encore aimé ce post.
        </p>
      ) : (
        <div className="-mx-2 space-y-1">
          {likes.map((like) => (
            <div key={like._id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-[var(--accent)]">
              <Avatar name={like.name} src={like.imageUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-[var(--foreground)]">{like.name}</p>
                <p className="text-xs text-[var(--muted-foreground)]">{formatRelative(like.createdAt)}</p>
              </div>
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white">
                <ThumbsUp className="h-3.5 w-3.5 fill-current" />
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function PostMediaViewer({
  media,
  index,
  onIndexChange,
  onClose,
}: {
  media: PostMedia[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const current = media[index];
  const hasMany = media.length > 1;

  function move(delta: number) {
    onIndexChange((index + delta + media.length) % media.length);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft" && hasMany) move(-1);
      if (event.key === "ArrowRight" && hasMany) move(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!current) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${index + 1} / ${media.length}`}
      className="bg-[var(--card)] text-[var(--foreground)] sm:h-[92vh] sm:w-[96vw] sm:max-w-[96vw]"
    >
      <div className="relative flex min-h-[55vh] items-center justify-center rounded-xl bg-[var(--accent)] sm:min-h-[68vh]">
        {hasMany ? (
          <>
            <button
              type="button"
              onClick={() => move(-1)}
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--card)] p-3 text-[var(--foreground)] shadow-lg ring-1 ring-[var(--border)] transition hover:bg-[var(--accent)] sm:left-3"
              aria-label="Média précédent"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--card)] p-3 text-[var(--foreground)] shadow-lg ring-1 ring-[var(--border)] transition hover:bg-[var(--accent)] sm:right-3"
              aria-label="Média suivant"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          </>
        ) : null}

        {current.kind === "image" ? (
          <img src={current.url} alt="" className="max-h-[70vh] max-w-full object-contain sm:max-h-[74vh]" />
        ) : (
          <video key={current.url} src={current.url} controls autoPlay playsInline className="max-h-[70vh] max-w-full bg-[var(--accent)] object-contain sm:max-h-[74vh]" />
        )}
      </div>
      {hasMany ? (
        <div className="thin-scroll mt-4 flex justify-center gap-2 overflow-x-auto pb-1">
          {media.map((item, itemIndex) => (
            <button
              key={`${item.kind}-${item.url}`}
              type="button"
              onClick={() => onIndexChange(itemIndex)}
              className={cn(
                "h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 bg-[var(--accent)] transition",
                itemIndex === index ? "border-brand-400" : "border-transparent opacity-60 hover:opacity-100",
              )}
              aria-label={`Ouvrir le média ${itemIndex + 1}`}
            >
              {item.kind === "image" ? (
                <img src={item.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[var(--accent)] text-xs font-bold text-[var(--foreground)]">
                  Vidéo
                </div>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}

function externalHref(value: string) {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function PostBody({
  body,
  expanded,
  onExpand,
}: {
  body: string;
  expanded: boolean;
  onExpand: () => void;
}) {
  const { text, truncated } = truncatePostBody(body, 150);
  const visibleBody = expanded ? body : text;

  return (
    <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">
      {visibleBody}
      {!expanded && truncated ? (
        <>
          {" "}
          <button
            type="button"
            onClick={onExpand}
            className="font-medium text-[var(--foreground)] underline underline-offset-4 hover:text-brand-700"
          >
            lire plus
          </button>
        </>
      ) : null}
    </p>
  );
}

function truncatePostBody(body: string, limit: number) {
  const chars = Array.from(body);
  if (chars.length <= limit) return { text: body, truncated: false };
  return { text: `${chars.slice(0, limit).join("").trimEnd()}...`, truncated: true };
}

function likeSummary(latestLikeName: string | undefined, likesCount: number) {
  if (likesCount <= 0) return "";
  const name = latestLikeName ?? "Quelqu'un";
  if (likesCount === 1) return `${name} a liké ce post`;
  return `${name} et ${likesCount - 1} autre${likesCount - 1 > 1 ? "s" : ""} personne${likesCount - 1 > 1 ? "s" : ""} ont liké ce post`;
}

/* ─── Événements ─────────────────────────────────────────────────────────── */

function Evenements({
  canCreate,
  canPublish,
}: {
  canCreate: boolean;
  canPublish: boolean;
}) {
  // Le calendrier ne charge que le mois affiché, grille complète comprise :
  // un évènement du 31 août visible sur la case de la première semaine de
  // septembre doit être chargé avec septembre.
  const [month, setMonth] = useState(() => startOfMonth(new Date()).getTime());
  const range = useMemo(() => {
    const base = new Date(month);
    return {
      from: startOfWeek(startOfMonth(base), { weekStartsOn: 1 }).getTime(),
      to: endOfWeek(endOfMonth(base), { weekStartsOn: 1 }).getTime(),
    };
  }, [month]);
  const calendar = useQuery(api.community.calendarEvents, range);
  const undated = useQuery(api.community.undatedEvents, {});
  const [openId, setOpenId] = useState<string | null>(null);
  const createEvent = useMutation(api.community.createEvent);
  const removeEvent = useMutation(api.community.removeEvent);
  const generatePost = useAction(api.community.generateEventPost);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    relatedEvent: "",
    organizer: "",
    animationType: "",
    structure: "",
    activity: "",
    targetAudience: "",
    urls: "",
    start: null as number | null,
    end: null as number | null,
  });
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [workerIds, setWorkerIds] = useState<Id<"polyvalentWorkers">[]>([]);
  const customOptions = useQuery(api.community.eventOptions, open ? {} : "skip");
  const optionsByField = useMemo(() => {
    const map: Record<EventOptionField, string[]> = {
      animationType: [],
      structure: [],
      activity: [],
      targetAudience: [],
    };
    for (const option of customOptions ?? []) {
      if (option.field in map) map[option.field as EventOptionField].push(option.label);
    }
    return map;
  }, [customOptions]);
  const eventHours =
    form.start && form.end ? Math.max(0, form.end - form.start) / 3_600_000 : 0;
  const [saving, setSaving] = useState(false);
  const [aiContext, setAiContext] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  async function generate() {
    if (!aiContext.trim()) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const result = await generatePost({ context: aiContext });
      setForm((current) => ({
        ...current,
        title: result.title || current.title,
        description: result.description || current.description,
        location: result.location || current.location,
      }));
    } catch (caught) {
      setAiError(caught instanceof Error ? caught.message : "Génération impossible.");
    } finally {
      setAiLoading(false);
    }
  }

  async function save() {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await createEvent({
        title: form.title,
        description: form.description || undefined,
        location: form.location || undefined,
        relatedEvent: form.relatedEvent || undefined,
        organizer: form.organizer || undefined,
        animationType: form.animationType || undefined,
        structure: form.structure || undefined,
        activity: form.activity || undefined,
        targetAudience: form.targetAudience || undefined,
        start: form.start ?? undefined,
        end: form.end ?? undefined,
        images,
        attachments: attachments.map((item) => item.storageId),
        urls: form.urls
          .split(/\n|,/)
          .map((url) => url.trim())
          .filter(Boolean),
        workerIds,
      });
      setForm({
        title: "",
        description: "",
        location: "",
        relatedEvent: "",
        organizer: "",
        animationType: "",
        structure: "",
        activity: "",
        targetAudience: "",
        urls: "",
        start: null,
        end: null,
      });
      setImages([]);
      setAttachments([]);
      setWorkerIds([]);
      setAiContext("");
      setAiError(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (calendar === undefined) return <FullSpinner label="Chargement..." />;

  async function removeEventWithConfirmation(eventId: Id<"events">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement cet événement ?"))) return;
    void removeEvent({ eventId });
  }

  return (
    <div className="space-y-5">
      {canCreate ? (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}><CalendarPlus className="h-4 w-4" /> Nouvel événement</Button>
        </div>
      ) : null}

      <CalendarBoard
        month={month}
        onMonthChange={(next) => setMonth(startOfMonth(next).getTime())}
        events={(calendar ?? []).map((event) => ({
          id: event.id,
          start: event.start,
          end: event.end,
          title: event.title,
          subtitle: event.location ?? undefined,
          // Deux origines, deux couleurs : on voit d'un coup d'œil ce qui vient
          // du calendrier de la Recyclerie.
          tone: event.kind === "recyclerie" ? "violet" : "brand",
        }))}
        onEventClick={(id) => setOpenId(id)}
      />

      {calendar !== undefined && calendar.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="h-8 w-8" />}
          title="Aucun événement ce mois-ci"
          description="Les événements internes et ceux partagés depuis le calendrier de la Recyclerie apparaîtront ici."
        />
      ) : null}

      {undated && undated.length > 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">Sans date précise</h3>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {undated.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(event.id)}
                  className="flex w-full items-center gap-3 py-2.5 text-left"
                >
                  <PartyPopper className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{event.title}</span>
                  <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                    {event.authorName}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal open={open} onClose={() => setOpen(false)} title="Nouvel événement">
        <div className="grid gap-4">
          {/* Assistant IA en premier : on décrit le contexte, l'IA remplit le reste. */}
          <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-brand-700 dark:text-brand-300">
              <Sparkles className="h-4 w-4" /> Rédaction assistée par l'IA
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">
              Décrivez l'événement en quelques mots, l'IA rédige le titre, le lieu et le post (sauf les photos).
            </p>
            <Textarea
              value={aiContext}
              onChange={(e) => setAiContext(e.target.value)}
              placeholder="Ex. Déstockage à la recyclerie samedi matin, tout à 2 euros, vêtements et petit mobilier..."
              className="mt-3 min-h-[80px]"
            />
            <div className="mt-2 flex justify-end">
              <Button type="button" variant="secondary" onClick={generate} disabled={aiLoading || !aiContext.trim()}>
                <Sparkles className="h-4 w-4" /> {aiLoading ? "Rédaction..." : "Rédiger avec l'IA"}
              </Button>
            </div>
            {aiError ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{aiError}</p> : null}
          </div>

          <Field label="Titre" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>

          {/* Mêmes champs que le calendrier de la Recyclerie, avec le même
              vocabulaire : les deux se lisent côte à côte dans le calendrier. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {EVENT_OPTION_LABELS.map(([key, label]) => (
              <Field key={key} label={label}>
                <EventOptionSelect
                  field={key}
                  value={form[key]}
                  onChange={(value) => setForm((current) => ({ ...current, [key]: value }))}
                  extraOptions={optionsByField[key]}
                  canCreateOption={canCreate}
                />
              </Field>
            ))}
            <Field label="Où ?"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Field label="Évènement rattaché"><Input value={form.relatedEvent} onChange={(e) => setForm({ ...form, relatedEvent: e.target.value })} /></Field>
            <Field label="Référent / organisateur"><Input value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} /></Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date et heure de début" hint="Optionnel : laissez vide pour un événement sans date précise.">
              <DateTimePicker
                value={form.start}
                onChange={(value) => setForm((current) => ({ ...current, start: value }))}
                placeholder="Choisir le début"
              />
            </Field>
            <Field label="Date et heure de fin">
              <DateTimePicker
                value={form.end}
                onChange={(value) => setForm((current) => ({ ...current, end: value }))}
                placeholder="Choisir la fin"
              />
            </Field>
          </div>

          <Field label="Salariés mobilisés">
            <EventWorkerPicker value={workerIds} onChange={setWorkerIds} eventHours={eventHours} />
          </Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Photos"><PhotoUpload value={images} onChange={setImages} /></Field>
          <Field label="Pièces jointes"><AttachmentUpload items={attachments} onChange={setAttachments} /></Field>
          <Field label="URLs" hint="Une URL par ligne.">
            <Textarea value={form.urls} onChange={(e) => setForm({ ...form, urls: e.target.value })} placeholder="https://…" />
          </Field>
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
            <Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={save} disabled={saving || !form.title.trim()}>
              <Plus className="h-4 w-4" /> {saving ? "Création..." : "Créer"}
            </Button>
          </div>
        </div>
      </Modal>

      {openId ? (
        <CalendarEventDetail
          canPublish={canPublish}
          event={
            [...(calendar ?? []), ...(undated ?? [])].find((item) => item.id === openId) ?? null
          }
          onClose={() => setOpenId(null)}
          onDelete={
            canCreate
              ? (eventId) => {
                  void removeEventWithConfirmation(eventId);
                  setOpenId(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/** Évènement du calendrier partagé : celui de Mes Outils, ou de la Recyclerie. */
type CalendarItem = {
  kind: "mesoutils" | "recyclerie";
  id: string;
  eventId?: Id<"events">;
  title: string;
  description?: string;
  location?: string;
  start?: number;
  end?: number;
  imageUrls: string[];
  imageIds?: Id<"_storage">[];
  authorName: string;
  authorImageUrl?: string;
  structure?: string;
  animationType?: string;
  activity?: string;
  relatedEvent?: string;
  targetAudience?: string;
  organizer?: string;
  urls?: string[];
  attachmentUrls?: string[];
  canManage: boolean;
};

function CalendarEventDetail({
  event,
  onClose,
  onDelete,
  canPublish,
}: {
  event: CalendarItem | null;
  onClose: () => void;
  onDelete?: (eventId: Id<"events">) => void;
  canPublish: boolean;
}) {
  const [facebookOpen, setFacebookOpen] = useState(false);
  const [instagramOpen, setInstagramOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const verifyPosts = useAction(api.social.verifyEventPosts);
  const posts = useQuery(
    api.social.postsForEvent,
    event
      ? event.kind === "mesoutils"
        ? { eventId: event.eventId as Id<"events"> }
        : { recycappEventId: event.id as Id<"recycappCalendarEvents"> }
      : "skip",
  );
  const eventKey = event?.id;
  const eventKind = event?.kind;
  const mesoutilsEventId = event?.eventId;
  useEffect(() => {
    if (!eventKey) return;
    // Une publication supprimée depuis Facebook doit disparaître d'ici : la
    // repasse horaire s'en charge, cet appel évite d'attendre jusque-là.
    void verifyPosts(
      eventKind === "mesoutils"
        ? { eventId: mesoutilsEventId as Id<"events"> }
        : { recycappEventId: eventKey as Id<"recycappCalendarEvents"> },
    ).catch(() => undefined);
  }, [eventKey, eventKind, mesoutilsEventId, verifyPosts]);

  if (!event) return null;
  const details = (
    [
      ["Type d'animation", event.animationType],
      ["Structure", event.structure],
      ["Activité", event.activity],
      ["Évènement rattaché", event.relatedEvent],
      ["Public(s) ciblé(s)", event.targetAudience],
      ["Référent / organisateur", event.organizer],
    ] as const
  ).filter(([, value]) => Boolean(value));

  return (
    <Modal open onClose={onClose} title={event.title}>
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              event.kind === "recyclerie"
                ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                : "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
            )}
          >
            {event.kind === "recyclerie" ? "Calendrier Recyclerie" : "Mes Outils"}
          </span>
          {event.start ? (
            <span className="text-sm text-[var(--muted-foreground)]">
              {formatDateTime(event.start)}
              {event.end ? ` → ${formatDateTime(event.end)}` : ""}
            </span>
          ) : (
            <span className="text-sm text-[var(--muted-foreground)]">Date à venir</span>
          )}
        </div>

        {event.imageUrls.length > 0 ? (
          <img
            src={event.imageUrls[0]}
            alt={event.title}
            className="max-h-[45vh] w-full rounded-2xl border border-[var(--border)] object-contain"
          />
        ) : null}

        {event.location ? (
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
            <MapPin className="h-4 w-4 text-brand-600" />
            {event.location}
          </p>
        ) : null}

        {event.description ? (
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">
            {event.description}
          </p>
        ) : null}

        {details.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                  {label}
                </dt>
                <dd className="mt-0.5 text-sm text-[var(--foreground)]">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {event.attachmentUrls && event.attachmentUrls.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Pièces jointes
            </p>
            <ul className="space-y-1.5">
              {event.attachmentUrls.map((url, index) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-brand-600 underline underline-offset-2"
                  >
                    Ouvrir la pièce jointe {index + 1}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {event.urls && event.urls.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Liens utiles
            </p>
            <ul className="space-y-1.5">
              {event.urls.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all text-sm font-medium text-brand-600 underline underline-offset-2"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {notice ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            {notice}
          </p>
        ) : null}

        {posts && posts.length > 0 ? (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-4">
            <ul className="space-y-2 text-sm">
              {posts.map((post) => (
                <li key={post.id} className="flex items-start gap-2">
                  {post.network === "instagram" ? (
                    <InstagramIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#E1306C]" />
                  ) : (
                    <FacebookIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#1877F2]" />
                  )}
                  <span className="text-[var(--foreground)]">
                    {/* Une publication programmée n'est pas encore parue : le
                        dire évite de croire l'évènement déjà annoncé. */}
                    {post.scheduledFor
                      ? `Publication programmée sur ${post.network === "instagram" ? "Instagram" : "Facebook"} (${post.pageName}) pour le ${formatDateTime(post.scheduledFor)} par ${post.authorName}`
                      : `Publié sur ${post.network === "instagram" ? "Instagram" : "Facebook"} (${post.pageName}) le ${formatDateTime(post.createdAt)} par ${post.authorName}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-sm text-[var(--muted-foreground)]">Proposé par {event.authorName}</p>
          <div className="flex gap-2">
            {canPublish ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setFacebookOpen(true)}>
                  <FacebookIcon className="h-4 w-4 text-[#1877F2]" /> Publier sur Facebook
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setInstagramOpen(true)}>
                  <InstagramIcon className="h-4 w-4 text-[#E1306C]" /> Publier sur Instagram
                </Button>
              </>
            ) : null}
            {/* Un évènement de la Recyclerie se modifie dans Recycapp : le
                dupliquer ici ferait exister deux versions du même évènement. */}
            {event.kind === "mesoutils" && event.canManage && event.eventId && onDelete ? (
              <Button variant="ghost" size="sm" onClick={() => onDelete(event.eventId!)}>
                <Trash2 className="h-4 w-4" /> Supprimer
              </Button>
            ) : null}
            <Button size="sm" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      </div>

      {facebookOpen ? (
        <FacebookPublishDialog
          event={event}
          onClose={() => setFacebookOpen(false)}
          onPublished={setNotice}
        />
      ) : null}

      {instagramOpen ? (
        <InstagramPublishDialog
          event={event}
          onClose={() => setInstagramOpen(false)}
          onPublished={setNotice}
        />
      ) : null}
    </Modal>
  );
}

/**
 * Publication d'un évènement sur une Page Facebook.
 *
 * Le formulaire est pré-rempli depuis l'évènement mais tout se corrige : un
 * post Facebook ne s'écrit pas comme une fiche interne, et le recopier tel
 * quel donnait des publications sèches.
 *
 * Facebook programme lui-même : on lui remet le post avec sa date et il le
 * publie à l'heure dite. Rien à surveiller de notre côté, et rien à rejouer si
 * le déploiement redémarre entre-temps.
 */
function FacebookPublishDialog({
  event,
  onClose,
  onPublished,
}: {
  event: CalendarItem;
  onClose: () => void;
  onPublished: (message: string) => void;
}) {
  const pages = useQuery(api.social.listPages, {});
  const publish = useAction(api.social.publishEvent);
  const { user } = useUser();
  // Facebook attribue toujours un post de Page à la Page : le nom de la
  // personne ne peut apparaître que dans le texte, en signature.
  const authorName =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  const [signed, setSigned] = useState(true);
  const [pageId, setPageId] = useState("");
  const [title, setTitle] = useState(event.title);
  const [body, setBody] = useState(() => defaultFacebookBody(event));
  // Les photos de l'évènement sont proposées cochées ; on peut en retirer et
  // en ajouter d'autres, qui ne servent qu'au post.
  const [photos, setPhotos] = useState<Id<"_storage">[]>(event.imageIds ?? []);
  const [extraPhotos, setExtraPhotos] = useState<Id<"_storage">[]>([]);
  const [mode, setMode] = useState<"now" | "scheduled">("now");
  const [scheduledFor, setScheduledFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Une seule Page configurée : inutile de faire choisir.
    if (pages && pages.length === 1) setPageId(pages[0].pageId);
  }, [pages]);

  const pageName = pages?.find((page) => page.pageId === pageId)?.name;
  const signature = signed && authorName ? `Publié par ${authorName}` : "";
  const message = [title.trim(), body.trim(), signature]
    .filter(Boolean)
    .join("\n\n");
  const allPhotos = [...photos, ...extraPhotos];
  const ready =
    Boolean(pageId) &&
    Boolean(message) &&
    (mode === "now" || scheduledFor !== null);

  function togglePhoto(id: Id<"_storage">) {
    setPhotos((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await publish({
        ...(event.kind === "mesoutils"
          ? { eventId: event.eventId as Id<"events"> }
          : { recycappEventId: event.id as Id<"recycappCalendarEvents"> }),
        pageId,
        message,
        photoStorageIds: allPhotos,
        ...(mode === "scheduled" && scheduledFor !== null ? { scheduledFor } : {}),
      });
      onPublished(
        mode === "scheduled" && scheduledFor !== null
          ? `Publication programmée sur ${pageName} pour le ${formatDateTime(scheduledFor)}.`
          : `Publié sur ${pageName}.`,
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publication impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Publier sur Facebook">
      <div className="grid gap-4">
        {pages === undefined ? (
          <p className="text-sm text-[var(--muted-foreground)]">Chargement des Pages…</p>
        ) : pages.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            Aucune Page Facebook n'est encore connectée. Les Pages et leurs jetons se
            configurent sur le déploiement.
          </p>
        ) : (
          <Field label="Page Facebook" required>
            <Select value={pageId} onChange={(e) => setPageId(e.target.value)}>
              <option value="">Choisir une Page…</option>
              {pages.map((page) => (
                <option key={page.pageId} value={page.pageId}>
                  {page.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Titre" hint="Première ligne du post.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <Field label="Message" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="min-h-[160px]"
            placeholder="Le texte de la publication…"
          />
        </Field>

        {event.imageUrls.length > 0 && (event.imageIds?.length ?? 0) > 0 ? (
          <Field label="Photos de l'évènement" hint="Cliquez pour retirer ou remettre.">
            <div className="flex flex-wrap gap-2">
              {event.imageIds!.map((id, index) => {
                const selected = photos.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => togglePhoto(id)}
                    className={cn(
                      "relative h-20 w-20 overflow-hidden rounded-xl border-2 transition",
                      selected
                        ? "border-brand-500"
                        : "border-transparent opacity-40 hover:opacity-70",
                    )}
                  >
                    <img
                      src={event.imageUrls[index]}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    {selected ? (
                      <span className="absolute right-1 top-1 rounded-full bg-brand-500 p-0.5 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}

        {authorName ? (
          <Checkbox
            checked={signed}
            onChange={setSigned}
            label={`Signer « Publié par ${authorName} »`}
            description="Facebook signe le post du nom de la Page : votre nom n'apparaît que si vous l'ajoutez au texte."
          />
        ) : null}

        <Field label="Ajouter des photos" hint="Elles n'appartiennent qu'à la publication.">
          <PhotoUpload value={extraPhotos} onChange={setExtraPhotos} />
        </Field>

        <Field label="Quand publier ?" required>
          <div className="flex gap-2">
            {([
              ["now", "Immédiatement"],
              ["scheduled", "Programmer"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors",
                  mode === value
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {mode === "scheduled" ? (
          <Field
            label="Date et heure de publication"
            required
            hint="Facebook exige au moins 10 minutes d'avance, et 6 mois au plus."
          >
            <DateTimePicker
              value={scheduledFor}
              onChange={setScheduledFor}
              placeholder="Choisir la date de publication"
            />
          </Field>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            {allPhotos.length === 0
              ? "Publication sans photo"
              : `${allPhotos.length} photo${allPhotos.length > 1 ? "s" : ""}`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !ready}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {busy
                ? "Envoi…"
                : mode === "scheduled"
                  ? "Programmer la publication"
                  : "Publier maintenant"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}


/**
 * Publication d'un évènement sur un ou plusieurs comptes Instagram.
 *
 * Instagram diffère de Facebook sur deux points qui se voient ici : une photo
 * est obligatoire — un post texte n'existe pas — et l'API ne sait pas
 * programmer, la publication part donc immédiatement.
 */
function InstagramPublishDialog({
  event,
  onClose,
  onPublished,
}: {
  event: CalendarItem;
  onClose: () => void;
  onPublished: (message: string) => void;
}) {
  const accounts = useQuery(api.social.listInstagramAccounts, {});
  const publish = useAction(api.social.publishEventToInstagram);
  const { user } = useUser();
  const authorName =
    user?.fullName?.trim() ||
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  const [selected, setSelected] = useState<string[]>([]);
  const [signed, setSigned] = useState(true);
  const [caption, setCaption] = useState(() =>
    [event.title, defaultFacebookBody(event)].filter(Boolean).join("\n\n"),
  );
  const [photos, setPhotos] = useState<Id<"_storage">[]>(event.imageIds ?? []);
  const [extraPhotos, setExtraPhotos] = useState<Id<"_storage">[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allPhotos = [...photos, ...extraPhotos];
  const signature = signed && authorName ? `Publié par ${authorName}` : "";
  const message = [caption.trim(), signature].filter(Boolean).join("\n\n");
  const ready = selected.length > 0 && allPhotos.length > 0 && Boolean(message);

  function toggleAccount(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const result = await publish({
        ...(event.kind === "mesoutils"
          ? { eventId: event.eventId as Id<"events"> }
          : { recycappEventId: event.id as Id<"recycappCalendarEvents"> }),
        instagramIds: selected,
        message,
        photoStorageIds: allPhotos,
      });
      // Un compte en échec n'annule pas les autres : on dit ce qui est passé.
      onPublished(
        result.failed.length > 0
          ? `Publié sur ${result.published.join(", ")}. Échec sur ${result.failed
              .map((item) => item.account)
              .join(", ")}.`
          : `Publié sur ${result.published.join(", ")}.`,
      );
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publication impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Publier sur Instagram">
      <div className="grid gap-4">
        {accounts === undefined ? (
          <p className="text-sm text-[var(--muted-foreground)]">Chargement des comptes…</p>
        ) : accounts.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
            Aucun compte Instagram n'est rattaché à vos Pages. Un compte doit être
            professionnel et lié à sa Page Facebook pour pouvoir être publié depuis ici.
          </p>
        ) : (
          <Field label="Comptes Instagram" required hint="Plusieurs comptes possibles.">
            <div className="grid gap-2">
              {accounts.map((account) => {
                const checked = selected.includes(account.instagramId);
                return (
                  <button
                    key={account.instagramId}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleAccount(account.instagramId)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition",
                      checked
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                        : "border-[var(--border)] bg-[var(--card)] hover:border-brand-400",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                        checked
                          ? "border-brand-500 bg-brand-500 text-white"
                          : "border-[var(--border)] bg-[var(--input)]",
                      )}
                    >
                      {checked ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
                    </span>
                    <InstagramIcon className="h-4 w-4 shrink-0 text-[#E1306C]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-[var(--foreground)]">
                        @{account.username}
                      </span>
                      <span className="block truncate text-xs text-[var(--muted-foreground)]">
                        via {account.pageName}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <Field label="Légende" required>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            className="min-h-[160px]"
            placeholder="Le texte de la publication…"
          />
        </Field>

        {authorName ? (
          <Checkbox
            checked={signed}
            onChange={setSigned}
            label={`Signer « Publié par ${authorName} »`}
          />
        ) : null}

        {event.imageUrls.length > 0 && (event.imageIds?.length ?? 0) > 0 ? (
          <Field label="Photos de l'évènement" hint="Cliquez pour retirer ou remettre.">
            <div className="flex flex-wrap gap-2">
              {event.imageIds!.map((id, index) => {
                const kept = photos.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() =>
                      setPhotos((current) =>
                        current.includes(id)
                          ? current.filter((value) => value !== id)
                          : [...current, id],
                      )
                    }
                    className={cn(
                      "relative h-20 w-20 overflow-hidden rounded-xl border-2 transition",
                      kept ? "border-brand-500" : "border-transparent opacity-40 hover:opacity-70",
                    )}
                  >
                    <img src={event.imageUrls[index]} alt="" className="h-full w-full object-cover" />
                    {kept ? (
                      <span className="absolute right-1 top-1 rounded-full bg-brand-500 p-0.5 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}

        <Field
          label="Ajouter des photos"
          required={allPhotos.length === 0}
          hint="Instagram exige au moins une photo. Dix au plus, en carrousel."
        >
          <PhotoUpload value={extraPhotos} onChange={setExtraPhotos} />
        </Field>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-[var(--muted-foreground)]">
            {/* Dit d'emblée ce que Facebook permet et pas Instagram, plutôt que
                de laisser chercher un bouton « Programmer » absent. */}
            Instagram ne permet pas de programmer : la publication part maintenant.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !ready}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <InstagramIcon className="h-4 w-4" />
              )}
              {busy ? "Envoi…" : `Publier${selected.length > 1 ? ` (${selected.length})` : ""}`}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Corps pré-rempli : la date, le lieu, puis la description de l'évènement. */
function defaultFacebookBody(event: CalendarItem) {
  const lines: string[] = [];
  if (event.start) {
    lines.push(
      new Date(event.start).toLocaleString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.description) lines.push("", event.description);
  return lines.join("\n");
}

/* ─── Bons plans ─────────────────────────────────────────────────────────── */

type Deal = {
  _id: Id<"dealPosts">;
  authorClerkId: string;
  authorName: string;
  title: string;
  description: string;
  adKind: DealAdKind;
  dealType: DealType;
  price?: number;
  rentalPeriod?: RentalPeriod;
  availableFrom?: number;
  availableTo?: number;
  imageUrls: string[];
  status: "open" | "closed";
  canManage: boolean;
  isMine: boolean;
};

/** Lien vers la messagerie pré-remplie façon "leboncoin" pour un bon plan. */
function contactDealHref(deal: Deal) {
  const price = dealPriceLabel(deal);
  const priceLabel = price ? ` (${price})` : "";
  const prefill = `Bonjour, je suis intéressé(e) par votre annonce « ${deal.title} »${priceLabel}. Est-elle toujours disponible ?`;
  const params = new URLSearchParams({
    to: deal.authorClerkId,
    name: deal.authorName,
    prefill,
    ctxDealId: deal._id,
    ctxTitle: deal.title,
  });
  if (deal.imageUrls[0]) params.set("ctxImage", deal.imageUrls[0]);
  if (deal.description.trim()) params.set("ctxDesc", deal.description.trim().slice(0, 280));
  const typeLabel = DEAL_TYPES.find((t) => t.key === deal.dealType)?.label;
  if (typeLabel) params.set("ctxType", typeLabel);
  if (price) params.set("ctxPrice", price);
  return `/messagerie?${params.toString()}`;
}

const DEAL_BADGE: Record<DealType, string> = {
  pret: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
  don: "bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-200",
  vente: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  echange: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  location: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200",
};

const DEAL_KIND_FILTERS = [
  { key: "all", label: "Toutes" },
  { key: "offre", label: "Je propose" },
  { key: "demande", label: "Je recherche" },
] as const;

const DEAL_KIND_BADGE: Record<DealAdKind, string> = {
  offre: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  demande: "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
};

const DEAL_KIND_LABEL: Record<DealAdKind, string> = {
  offre: "Je propose",
  demande: "Je recherche",
};

function BonsPlans({ canCreate }: { canCreate: boolean }) {
  const navigate = useNavigate();
  const deals = useQuery(api.community.listDeals) as Deal[] | undefined;
  const createDeal = useMutation(api.community.createDeal);
  const removeDeal = useMutation(api.community.removeDeal);
  const setStatus = useMutation(api.community.setDealStatus);

  const [open, setOpen] = useState(false);
  const [detailDeal, setDetailDeal] = useState<Deal | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | DealAdKind>("all");
  const [form, setForm] = useState({
    title: "",
    description: "",
    adKind: "offre" as DealAdKind,
    dealType: "pret" as DealType,
    price: "",
    rentalPeriod: "jour" as RentalPeriod,
    from: null as number | null,
    to: null as number | null,
  });
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [saving, setSaving] = useState(false);

  const filteredDeals: Deal[] =
    kindFilter === "all"
      ? deals ?? []
      : (deals ?? []).filter((deal) => deal.adKind === kindFilter);

  function openComposer(adKind: DealAdKind) {
    setForm((current) => ({ ...current, adKind }));
    setOpen(true);
  }

  function contactDeal(deal: Deal) {
    navigate(contactDealHref(deal));
  }

  async function save() {
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      await createDeal({
        title: form.title,
        description: form.description,
        adKind: form.adKind,
        dealType: form.dealType,
        price:
          (form.dealType === "vente" || form.dealType === "location") && form.price
            ? Number(form.price)
            : undefined,
        rentalPeriod: form.dealType === "location" ? form.rentalPeriod : undefined,
        availableFrom: form.from ?? undefined,
        availableTo: form.to ?? undefined,
        images,
      });
      setForm({
        title: "",
        description: "",
        adKind: form.adKind,
        dealType: "pret",
        price: "",
        rentalPeriod: "jour",
        from: null,
        to: null,
      });
      setImages([]);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (deals === undefined) return <FullSpinner label="Chargement..." />;

  async function removeDealWithConfirmation(dealId: Id<"dealPosts">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement ce bon plan ?"))) return;
    void removeDeal({ dealId });
  }

  return (
    <div className="space-y-5">
      {canCreate ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => openComposer("demande")}>
            <CircleHelp className="h-4 w-4" /> Je recherche
          </Button>
          <Button onClick={() => openComposer("offre")}>
            <Plus className="h-4 w-4" /> Je propose
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {DEAL_KIND_FILTERS.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setKindFilter(filter.key)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-semibold transition",
              kindFilter === filter.key
                ? "bg-brand-500 text-white"
                : "bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filteredDeals.length === 0 ? (
        <EmptyState
          icon={<Tag className="h-8 w-8" />}
          title="Aucun bon plan"
          description="Prêt, don, vente, échange ou location entre collègues : proposez le premier."
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredDeals.map((deal) => (
            <article key={deal._id} className={cn("flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition hover:shadow-md", deal.status === "closed" && "opacity-60")}>
              <button type="button" onClick={() => setDetailDeal(deal)} className="group relative block text-left">
                {deal.imageUrls[0] ? (
                  <img src={deal.imageUrls[0]} alt="" className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-[var(--muted)]"><Tag className="h-10 w-10 text-[var(--muted-foreground)]" /></div>
                )}
                {deal.imageUrls.length > 1 ? (
                  <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                    {deal.imageUrls.length} photos
                  </span>
                ) : null}
              </button>
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", DEAL_KIND_BADGE[deal.adKind])}>
                      {DEAL_KIND_LABEL[deal.adKind]}
                    </span>
                    <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", DEAL_BADGE[deal.dealType])}>
                      {DEAL_TYPES.find((t) => t.key === deal.dealType)?.label}
                    </span>
                  </div>
                  {dealPriceLabel(deal) ? <span className="text-sm font-bold text-[var(--foreground)]">{dealPriceLabel(deal)}</span> : null}
                </div>
                <button type="button" onClick={() => setDetailDeal(deal)} className="mt-2 text-left">
                  <h3 className="text-lg font-bold text-[var(--foreground)] hover:text-brand-600">{deal.title}</h3>
                </button>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--muted-foreground)]">{deal.description}</p>
                {deal.availableFrom ? (
                  <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                    Dispo {formatDate(deal.availableFrom)}{deal.availableTo ? ` → ${formatDate(deal.availableTo)}` : ""}
                  </p>
                ) : null}
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">Par {deal.authorName}</p>
                <div className="mt-3 flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setDetailDeal(deal)}>
                    Voir les détails
                  </Button>
                  {deal.isMine ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setStatus({ dealId: deal._id, status: deal.status === "open" ? "closed" : "open" })}>
                        {deal.status === "open" ? "Clôturer" : "Rouvrir"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removeDealWithConfirmation(deal._id)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => contactDeal(deal)}>
                      <MessagesSquare className="h-4 w-4" /> Contacter
                    </Button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={form.adKind === "demande" ? "Publier une recherche" : "Proposer un bon plan"}
      >
        <div className="grid gap-4">
          <Field label="Titre" required><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Tronçonneuse à prêter" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type d'annonce">
              <Select value={form.adKind} onChange={(e) => setForm({ ...form, adKind: e.target.value as DealAdKind })}>
                <option value="offre">Je propose</option>
                <option value="demande">Je recherche</option>
              </Select>
            </Field>
            <Field label="Type">
              <Select value={form.dealType} onChange={(e) => setForm({ ...form, dealType: e.target.value as DealType })}>
                {DEAL_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}
              </Select>
            </Field>
          </div>
          {form.dealType === "vente" ? (
            <Field label="Prix (€)"><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
          ) : null}
          {form.dealType === "location" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Périodicité" required>
                <Select value={form.rentalPeriod} onChange={(e) => setForm({ ...form, rentalPeriod: e.target.value as RentalPeriod })}>
                  {RENTAL_PERIODS.map((period) => <option key={period.key} value={period.key}>{period.label}</option>)}
                </Select>
              </Field>
              <Field label={`Prix (€${RENTAL_PERIODS.find((p) => p.key === form.rentalPeriod)?.suffix ?? ""})`}>
                <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </Field>
            </div>
          ) : null}
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

      {detailDeal ? (
        <DealDetail
          deal={detailDeal}
          onClose={() => setDetailDeal(null)}
          onContact={() => { const deal = detailDeal; setDetailDeal(null); contactDeal(deal); }}
        />
      ) : null}
    </div>
  );
}

/** Fiche détaillée d'un bon plan : galerie d'images en grand + infos complètes. */
function DealDetail({ deal, onClose, onContact }: { deal: Deal; onClose: () => void; onContact: () => void }) {
  const [active, setActive] = useState(0);
  const images = deal.imageUrls;
  const typeLabel = DEAL_TYPES.find((t) => t.key === deal.dealType)?.label;
  return (
    <Modal open onClose={onClose} title={deal.title}>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {images.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--muted)]">
                <img src={images[active]} alt={deal.title} className="max-h-[60vh] w-full object-contain" />
              </div>
              {images.length > 1 ? (
                <div className="thin-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
                  {images.map((url, index) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setActive(index)}
                      className={cn(
                        "h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition",
                        index === active ? "border-brand-500" : "border-transparent opacity-70 hover:opacity-100",
                      )}
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-2xl bg-[var(--muted)]">
              <Tag className="h-12 w-12 text-[var(--muted-foreground)]" />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn("rounded-full px-3 py-1 text-xs font-bold", DEAL_KIND_BADGE[deal.adKind])}>{DEAL_KIND_LABEL[deal.adKind]}</span>
              <span className={cn("rounded-full px-3 py-1 text-xs font-bold", DEAL_BADGE[deal.dealType])}>{typeLabel}</span>
            </div>
            {dealPriceLabel(deal) ? <span className="text-2xl font-extrabold text-[var(--foreground)]">{dealPriceLabel(deal)}</span> : null}
          </div>
          <h2 className="mt-3 text-2xl font-bold text-[var(--foreground)]">{deal.title}</h2>
          {deal.status === "closed" ? (
            <span className="mt-2 inline-flex w-fit rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-bold text-[var(--muted-foreground)]">Clôturé</span>
          ) : null}
          <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">{deal.description}</p>
          {deal.availableFrom ? (
            <p className="mt-4 text-sm text-[var(--muted-foreground)]">
              Disponible {formatDate(deal.availableFrom)}{deal.availableTo ? ` → ${formatDate(deal.availableTo)}` : ""}
            </p>
          ) : null}
          <p className="mt-2 text-sm text-[var(--muted-foreground)]">Proposé par {deal.authorName}</p>
          {!deal.isMine ? (
            <div className="mt-auto pt-6">
              <Button className="w-full" onClick={onContact}>
                <MessagesSquare className="h-4 w-4" /> Contacter {deal.authorName}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
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
