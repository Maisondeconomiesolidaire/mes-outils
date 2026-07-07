import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  MapPin,
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
      <SectionHeader title="Espace partage" />
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
};
type PostMedia = { kind: "image" | "video"; url: string };
type PostLike = { _id: Id<"postLikes">; name: string; imageUrl?: string; createdAt: number };

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
  const updatePost = useMutation(api.posts.update);

  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [externalLink, setExternalLink] = useState("");
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [showMedia, setShowMedia] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
                placeholder="Titre"
                className="rounded-2xl bg-[var(--accent)]"
              />
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Quoi de neuf ?"
                className="min-h-[52px] w-full resize-none rounded-2xl bg-[var(--accent)] px-4 py-3 text-[15px] text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] focus:ring-2 focus:ring-brand-500/30"
                rows={body ? 3 : 1}
              />
              <Input
                value={externalLink}
                onChange={(event) => setExternalLink(event.target.value)}
                placeholder="Lien externe (optionnel)"
                className="rounded-2xl bg-[var(--accent)]"
              />
            </div>
          </div>
          {showMedia ? (
            <MediaUpload images={images} onChange={setImages} className="mt-3 pl-[60px]" />
          ) : null}
          <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-3">
            <button
              type="button"
              onClick={() => setShowMedia((current) => !current)}
              className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition", showMedia ? "bg-brand-50 text-brand-700" : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]")}
            >
              <ImageIcon className="h-4 w-4" /> Photo
            </button>
            <Button onClick={submit} disabled={submitting || (!title.trim() && !body.trim() && !externalLink.trim() && images.length === 0)}>
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
            onRemove={() => removePostWithConfirmation(post._id)}
            onUpdate={(next) => updatePost({ postId: post._id, ...next })}
            onAddComment={(text) => addComment({ postId: post._id, body: text })}
            onRemoveComment={removeCommentWithConfirmation}
          />
        ))
      )}
    </div>
  );
}

function PostCard({
  post, currentName, currentImage, canManage, canCreate, onToggleLike, onPin, onRemove, onUpdate, onAddComment, onRemoveComment,
}: {
  post: Post; currentName: string; currentImage?: string; canManage: boolean; canCreate: boolean;
  onToggleLike: () => void; onPin: () => void; onRemove: () => void; onUpdate: (next: { title?: string; body: string; externalLink?: string; images: Id<"_storage">[] }) => Promise<unknown>;
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
          {post.body ? <p className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">{post.body}</p> : null}
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
    {viewerIndex != null ? (
      <PostMediaViewer media={media} index={viewerIndex} onIndexChange={setViewerIndex} onClose={() => setViewerIndex(null)} />
    ) : null}
    <LikesModal open={likesOpen} likes={likes} onClose={() => setLikesOpen(false)} />
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
    <Modal open={open} onClose={onClose} title="Mentions J'aime" className="sm:h-auto sm:max-h-[80vh] sm:w-[520px] sm:max-w-[520px]">
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

function likeSummary(latestLikeName: string | undefined, likesCount: number) {
  if (likesCount <= 0) return "";
  const name = latestLikeName ?? "Quelqu'un";
  if (likesCount === 1) return `${name} a liké ce post`;
  return `${name} et ${likesCount - 1} autre${likesCount - 1 > 1 ? "s" : ""} personne${likesCount - 1 > 1 ? "s" : ""} ont liké ce post`;
}

/* ─── Événements ─────────────────────────────────────────────────────────── */

type EventItem = {
  _id: Id<"events">;
  authorName: string;
  authorImageUrl?: string;
  title: string;
  description?: string;
  location?: string;
  start?: number;
  end?: number;
  imageUrls: string[];
  canManage: boolean;
};

function Evenements({ canCreate }: { canCreate: boolean }) {
  const events = useQuery(api.community.listEvents) as EventItem[] | undefined;
  const createEvent = useMutation(api.community.createEvent);
  const removeEvent = useMutation(api.community.removeEvent);
  const generatePost = useAction(api.community.generateEventPost);
  const [open, setOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState<EventItem | null>(null);
  const [form, setForm] = useState({ title: "", description: "", location: "", start: null as number | null, end: null as number | null });
  const [images, setImages] = useState<Id<"_storage">[]>([]);
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
        start: form.start ?? undefined,
        end: form.end ?? undefined,
        images,
      });
      setForm({ title: "", description: "", location: "", start: null, end: null });
      setImages([]);
      setAiContext("");
      setAiError(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  if (events === undefined) return <FullSpinner label="Chargement..." />;

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

      {events.length === 0 ? (
        <EmptyState icon={<PartyPopper className="h-8 w-8" />} title="Aucun événement" description="Les événements internes apparaîtront ici." />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {events.map((event) => (
            <article key={event._id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
              <button type="button" onClick={() => setDetailEvent(event)} className="block w-full text-left">
                {event.imageUrls[0] ? (
                  <img src={event.imageUrls[0]} alt="" className="aspect-video w-full object-cover" />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-brand-50"><PartyPopper className="h-10 w-10 text-brand-500" /></div>
                )}
              </button>
              <div className="p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-brand-600">{event.start ? formatDate(event.start) : "Date à venir"}</p>
                <button type="button" onClick={() => setDetailEvent(event)} className="mt-1 text-left">
                  <h3 className="text-lg font-bold text-[var(--foreground)] hover:text-brand-600">{event.title}</h3>
                </button>
                {event.start ? (
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                    {formatDateTime(event.start)}{event.end ? ` → ${formatDateTime(event.end)}` : ""}
                  </p>
                ) : null}
                {event.location ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-[var(--foreground)]"><MapPin className="h-4 w-4 text-brand-600" />{event.location}</p>
                ) : null}
                {event.description ? <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{event.description}</p> : null}
                <p className="mt-3 text-xs text-[var(--muted-foreground)]">Proposé par {event.authorName}</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDetailEvent(event)}>
                    Voir les détails
                  </Button>
                  {event.canManage ? (
                    <Button variant="ghost" size="sm" onClick={() => removeEventWithConfirmation(event._id)}>
                      <Trash2 className="h-4 w-4" /> Supprimer
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

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
          <Field label="Lieu"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          <Field label="Période" hint="Optionnel : laissez vide pour un événement sans date précise.">
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
            <Button onClick={save} disabled={saving || !form.title.trim()}>
              <Plus className="h-4 w-4" /> {saving ? "Création..." : "Créer"}
            </Button>
          </div>
        </div>
      </Modal>

      {detailEvent ? (
        <EventDetail event={detailEvent} onClose={() => setDetailEvent(null)} />
      ) : null}
    </div>
  );
}

function EventDetail({ event, onClose }: { event: EventItem; onClose: () => void }) {
  const [active, setActive] = useState(0);
  return (
    <Modal open onClose={onClose} title={event.title} className="sm:max-w-4xl">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          {event.imageUrls.length > 0 ? (
            <>
              <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--muted)]">
                <img src={event.imageUrls[active]} alt={event.title} className="max-h-[60vh] w-full object-contain" />
              </div>
              {event.imageUrls.length > 1 ? (
                <div className="thin-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
                  {event.imageUrls.map((url, index) => (
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
            <div className="flex aspect-video items-center justify-center rounded-2xl bg-brand-50">
              <PartyPopper className="h-12 w-12 text-brand-500" />
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-600">
            {event.start ? formatDate(event.start) : "Date à venir"}
          </p>
          <h2 className="mt-2 text-2xl font-bold text-[var(--foreground)]">{event.title}</h2>
          {event.start ? (
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              {formatDateTime(event.start)}{event.end ? ` → ${formatDateTime(event.end)}` : ""}
            </p>
          ) : null}
          {event.location ? (
            <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--foreground)]">
              <MapPin className="h-4 w-4 text-brand-600" />{event.location}
            </p>
          ) : null}
          {event.description ? (
            <p className="mt-5 whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]">{event.description}</p>
          ) : (
            <p className="mt-5 text-sm text-[var(--muted-foreground)]">Aucune description pour le moment.</p>
          )}
          <div className="mt-auto flex items-center gap-3 pt-6">
            <Avatar name={event.authorName} src={event.authorImageUrl} size="sm" />
            <p className="text-sm text-[var(--muted-foreground)]">Proposé par {event.authorName}</p>
          </div>
        </div>
      </div>
    </Modal>
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
    ctxDealId: deal._id,
    ctxTitle: deal.title,
  });
  if (deal.imageUrls[0]) params.set("ctxImage", deal.imageUrls[0]);
  if (deal.description.trim()) params.set("ctxDesc", deal.description.trim().slice(0, 280));
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
  const [detailDeal, setDetailDeal] = useState<Deal | null>(null);
  const [form, setForm] = useState({ title: "", description: "", dealType: "pret" as DealType, price: "", from: null as number | null, to: null as number | null });
  const [images, setImages] = useState<Id<"_storage">[]>([]);
  const [saving, setSaving] = useState(false);

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

  async function removeDealWithConfirmation(dealId: Id<"dealPosts">) {
    if (!(await confirmPermanentDelete("Êtes-vous sûr(e) de vouloir supprimer définitivement ce bon plan ?"))) return;
    void removeDeal({ dealId });
  }

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
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-bold", DEAL_BADGE[deal.dealType])}>
                    {DEAL_TYPES.find((t) => t.key === deal.dealType)?.label}
                  </span>
                  {deal.price != null ? (
                    <span className="text-sm font-bold text-[var(--foreground)]">{deal.price} €</span>
                  ) : null}
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
    <Modal open onClose={onClose} title={deal.title} className="sm:max-w-4xl">
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
            <span className={cn("rounded-full px-3 py-1 text-xs font-bold", DEAL_BADGE[deal.dealType])}>{typeLabel}</span>
            {deal.price != null ? <span className="text-2xl font-extrabold text-[var(--foreground)]">{deal.price} €</span> : null}
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
