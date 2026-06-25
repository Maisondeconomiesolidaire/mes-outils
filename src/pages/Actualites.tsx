import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { MessageSquare, Newspaper, Pin, PinOff, Send, ThumbsUp, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { usePermissionsAccess } from "../components/RequirePermission";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Textarea, Input } from "../components/ui/Field";
import { PhotoUpload } from "../components/ui/PhotoUpload";
import { FullSpinner } from "../components/ui/Spinner";
import { formatDateTime, formatRelative } from "../lib/format";
import { canAccess } from "../lib/permissions";

export function Actualites() {
  const access = usePermissionsAccess();
  const posts = useQuery(api.posts.list, { limit: 60 });
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
    return <FullSpinner label="Chargement des actualites..." />;
  }

  return (
    <div className="space-y-6">
      <section className="border-b border-[var(--border)] pb-5">
        <p className="section-kicker">Espace partage</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-[var(--foreground)]">
              Publications internes
            </h2>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {posts.length} posts · {posts.filter((post) => post.pinned).length} epingles
            </p>
          </div>
        </div>
      </section>

      {canCreate ? (
        <section className="glass-card rounded-lg border border-[var(--border)] p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-lg font-semibold text-[var(--foreground)]">Nouvelle publication</p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Partage une note, une photo terrain ou une information d'equipe.
              </p>
            </div>
          </div>
          <Field label="Message">
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Quoi de neuf aujourd'hui ?"
            />
          </Field>
          <PhotoUpload value={images} onChange={setImages} className="mt-4" />
          <div className="mt-4 flex justify-end">
            <Button onClick={submitPost} disabled={submitting || (!body.trim() && images.length === 0)}>
              <Send className="h-4 w-4" />
              {submitting ? "Publication..." : "Publier"}
            </Button>
          </div>
        </section>
      ) : null}

      {posts.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="h-8 w-8" />}
          title="Aucune actualite pour le moment"
          description="Le fil est vide. La premiere publication apparaitra ici."
        />
      ) : (
        <div className="space-y-5">
          {posts.map((post) => (
            <article
              key={post._id}
              className="glass-card animate-enter rounded-lg border border-[var(--border)] p-5 sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 gap-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-[var(--accent)] text-sm font-semibold text-[var(--foreground)]">
                    {post.authorImageUrl ? (
                      <img
                        src={post.authorImageUrl}
                        alt={post.authorName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      post.authorName.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-semibold text-[var(--foreground)]">{post.authorName}</h3>
                      {post.pinned ? (
                        <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--foreground)]">
                          Epingle
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {formatDateTime(post.createdAt)} · {formatRelative(post.createdAt)}
                    </p>
                  </div>
                </div>
                {canManage ? (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => pinPost({ postId: post._id, pinned: !post.pinned })}
                    >
                      {post.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removePost({ postId: post._id })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ) : null}
              </div>

              {post.body ? <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[var(--foreground)]/90">{post.body}</p> : null}

              {post.imageUrls.length > 0 ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {post.imageUrls.map((imageUrl) => (
                    <img
                      key={imageUrl}
                      src={imageUrl}
                      alt=""
                      className="max-h-[320px] w-full rounded-lg border border-[var(--border)] object-cover"
                    />
                  ))}
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
                <button
                  type="button"
                  onClick={() => toggleLike({ postId: post._id })}
                  className="inline-flex items-center gap-2 font-medium text-[var(--foreground)]"
                >
                  <ThumbsUp className={`h-4 w-4 ${post.likedByMe ? "fill-current" : ""}`} />
                  {post.likesCount} j'aime
                </button>
                <span className="inline-flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  {post.commentsCount} commentaires
                </span>
              </div>

              <div className="mt-5 space-y-3 border-t border-[var(--border)] pt-4">
                {post.comments.map((comment) => (
                  <div key={comment._id} className="rounded-lg bg-[var(--accent)]/70 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--foreground)]">{comment.authorName}</p>
                        <p className="mt-1 text-sm leading-6 text-[var(--foreground)]/80">{comment.body}</p>
                        <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                          {formatRelative(comment.createdAt)}
                        </p>
                      </div>
                      {(comment.canRemove || canManage) ? (
                        <button
                          type="button"
                          onClick={() => removeComment({ commentId: comment._id })}
                          className="rounded-lg p-2 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}

                <div className="flex gap-2">
                  <Input
                    value={commentDrafts[post._id] ?? ""}
                    onChange={(event) =>
                      setCommentDrafts((current) => ({
                        ...current,
                        [post._id]: event.target.value,
                      }))
                    }
                    placeholder="Ajouter un commentaire..."
                  />
                  <Button
                    variant="secondary"
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
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
