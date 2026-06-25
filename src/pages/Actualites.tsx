import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ImagePlus, MessageCircle, MoreHorizontal, Pin, PinOff, Send, ThumbsUp, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Input, Textarea } from "../components/ui/Field";
import { PhotoUpload } from "../components/ui/PhotoUpload";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDateTime, formatRelative } from "../lib/format";
import { canAccess } from "../lib/permissions";

type Comment = {
  _id: Id<"postComments">;
  authorName: string;
  body: string;
  createdAt: number;
  canRemove?: boolean;
};

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

export function Actualites() {
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
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const canCreate = canAccess(access, "mesoutils:actualites", "create");
  const canManage = canAccess(access, "mesoutils:actualites", "manage");

  async function submitPost() {
    if (!body.trim() && images.length === 0) return;
    setSubmitting(true);
    try {
      await createPost({ body, images });
      setBody("");
      setImages([]);
    } finally {
      setSubmitting(false);
    }
  }

  if (posts === undefined) {
    return <FullSpinner label="Chargement de l'espace partage..." />;
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[280px_minmax(0,680px)_220px]">
      <aside className="hidden lg:block">
        <div className="premium-panel sticky top-32 rounded-[1.5rem] p-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Espace partage</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
            Le fil d'actualite interne.
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--muted-foreground)]">
            Photos terrain, annonces staff, retours d'equipe et informations epinglees.
          </p>
          <div className="mt-5 grid gap-3 text-sm">
            <Stat label="Publications" value={posts.length} />
            <Stat label="Epinglees" value={posts.filter((post) => post.pinned).length} />
          </div>
        </div>
      </aside>

      <main className="space-y-5">
        {canCreate ? (
          <section className="premium-panel overflow-hidden rounded-[1.5rem]">
            <div className="border-b border-[var(--border)] px-5 py-4">
              <p className="text-sm font-semibold text-[var(--foreground)]">Creer une publication</p>
            </div>
            <div className="p-5">
              <Textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="Partagez une information avec l'equipe..."
                className="min-h-28 resize-none border-0 bg-transparent px-0 text-base shadow-none focus:ring-0"
              />
              <PhotoUpload value={images} onChange={setImages} className="mt-4" />
              <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-4">
                <span className="inline-flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                  <ImagePlus className="h-4 w-4" />
                  Images, annonces et photos terrain
                </span>
                <Button onClick={submitPost} disabled={submitting || (!body.trim() && images.length === 0)}>
                  <Send className="h-4 w-4" />
                  {submitting ? "Publication..." : "Publier"}
                </Button>
              </div>
            </div>
          </section>
        ) : null}

        {posts.length === 0 ? (
          <EmptyState
            icon={<MessageCircle className="h-8 w-8" />}
            title="Aucune publication"
            description="Le premier post de l'equipe apparaitra ici."
          />
        ) : (
          posts.map((post) => (
            <article key={post._id} className="premium-panel animate-enter overflow-hidden rounded-[1.5rem]">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 gap-3">
                    <Avatar name={post.authorName} src={post.authorImageUrl} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate font-semibold text-[var(--foreground)]">{post.authorName}</h2>
                        {post.pinned ? (
                          <span className="rounded-full bg-brand-100 px-2.5 py-1 text-[11px] font-bold text-brand-800">
                            Epingle
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {formatRelative(post.createdAt)} · {formatDateTime(post.createdAt)}
                      </p>
                    </div>
                  </div>

                  {canManage ? (
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => pinPost({ postId: post._id, pinned: !post.pinned })}>
                        {post.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removePost({ postId: post._id })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <MoreHorizontal className="h-5 w-5 text-[var(--muted-foreground)]" />
                  )}
                </div>

                {post.body ? (
                  <p className="mt-4 whitespace-pre-wrap text-[15px] leading-7 text-[var(--foreground)]/92">
                    {post.body}
                  </p>
                ) : null}
              </div>

              {post.imageUrls.length > 0 ? (
                <div className={`grid gap-1 ${post.imageUrls.length === 1 ? "" : "sm:grid-cols-2"}`}>
                  {post.imageUrls.map((imageUrl) => (
                    <img key={imageUrl} src={imageUrl} alt="" className="max-h-[460px] w-full object-cover" />
                  ))}
                </div>
              ) : null}

              <div className="px-5 py-3 text-sm text-[var(--muted-foreground)]">
                {post.likesCount} j'aime · {post.commentsCount} commentaire{post.commentsCount > 1 ? "s" : ""}
              </div>

              <div className="grid grid-cols-2 border-y border-[var(--border)]">
                <SocialButton active={post.likedByMe} onClick={() => toggleLike({ postId: post._id })}>
                  <ThumbsUp className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} />
                  J'aime
                </SocialButton>
                <SocialButton>
                  <MessageCircle className="h-4 w-4" />
                  Commenter
                </SocialButton>
              </div>

              <div className="space-y-3 bg-[var(--accent)]/45 p-5">
                {post.comments.map((comment) => (
                  <div key={comment._id} className="flex gap-3">
                    <Avatar name={comment.authorName} size="sm" />
                    <div className="min-w-0 flex-1 rounded-2xl bg-[var(--card)] px-4 py-3 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-[var(--foreground)]">{comment.authorName}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--foreground)]/84">{comment.body}</p>
                          <p className="mt-1 text-xs text-[var(--muted-foreground)]">{formatRelative(comment.createdAt)}</p>
                        </div>
                        {comment.canRemove || canManage ? (
                          <button
                            type="button"
                            onClick={() => removeComment({ commentId: comment._id })}
                            className="rounded-full p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex gap-3">
                  <Avatar name={access?.email ?? "Moi"} size="sm" />
                  <div className="flex flex-1 gap-2">
                    <Input
                      value={commentDrafts[post._id] ?? ""}
                      onChange={(event) =>
                        setCommentDrafts((current) => ({
                          ...current,
                          [post._id]: event.target.value,
                        }))
                      }
                      placeholder="Ecrire un commentaire..."
                      className="rounded-full"
                    />
                    <Button
                      onClick={async () => {
                        const draft = commentDrafts[post._id]?.trim();
                        if (!draft) return;
                        await addComment({ postId: post._id, body: draft });
                        setCommentDrafts((current) => ({ ...current, [post._id]: "" }));
                      }}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))
        )}
      </main>

      <aside className="hidden lg:block">
        <div className="premium-panel sticky top-32 rounded-[1.5rem] p-5">
          <p className="text-sm font-semibold text-[var(--foreground)]">Bonnes pratiques</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">
            Epinglez uniquement les informations utiles a toute l'equipe. Les commentaires servent
            a clarifier, pas a remplacer les canaux operationnels urgents.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "sm" | "md" }) {
  const classes = size === "sm" ? "h-9 w-9 text-xs" : "h-12 w-12 text-sm";
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#111812] font-semibold text-white ${classes}`}>
      {src ? <img src={src} alt={name} className="h-full w-full object-cover" /> : name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function SocialButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-2 px-4 py-3 text-sm font-semibold transition hover:bg-[var(--accent)] ${
        active ? "text-brand-600" : "text-[var(--muted-foreground)]"
      }`}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-[var(--accent)] px-4 py-3">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span className="font-semibold text-[var(--foreground)]">{value}</span>
    </div>
  );
}
