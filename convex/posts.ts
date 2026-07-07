import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCrmPermission, requireUser } from "./lib";
import { createMesoutilsNotification } from "./mesoutilsNotifications";

const POSTS_PAGE_KEY = "mesoutils:actualites";
const POST_EDITOR_EMAILS = new Set(["lahmerselim@gmail.com"]);
const AIRTABLE_AUTHOR_EMAILS: Record<string, string> = {
  "henry gwendal": "g.henry@eco-solidaire.fr",
  "maccioni sara": "s.maccioni@eco-solidaire.fr",
  "tiennot stephane": "s.tiennot@eco-solidaire.fr",
  "prata yohann": "y.prata@eco-solidaire.fr",
};
const AIRTABLE_AUTHOR_FALLBACKS: Record<
  string,
  { clerkId: string; authorName: string; authorImageUrl?: string }
> = {
  "maccioni sara": {
    clerkId: "user_3FdYWQVvN6gMzDsVBaWR0rIzhIY",
    authorName: "Sara Maccioni",
    authorImageUrl:
      "https://img.clerk.com/eyJ0eXBlIjoiZGVmYXVsdCIsImlpZCI6Imluc18zRmN3Wjg5UnhIWnM3YjRBYzhmSzFXbTgwV2oiLCJyaWQiOiJ1c2VyXzNGZFlXUVZ2TjZnTXpEc1ZCYVdSMHJJemhJWSIsImluaXRpYWxzIjoiU00ifQ",
  },
};

function displayName(identity: {
  name?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
}) {
  const fullName = [identity.givenName, identity.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return identity.name?.trim() || fullName || identity.email?.trim() || "Utilisateur";
}

function normalizePersonKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLocaleLowerCase("fr-FR")
    .replace(/\s+/g, " ");
}

function canEditAnyPost(email: string | null | undefined) {
  return POST_EDITOR_EMAILS.has(email?.trim().toLowerCase() ?? "");
}

async function getUserByEmail(ctx: QueryCtx | MutationCtx, email: string) {
  return await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .first();
}

function dateFromAirtable(value: string) {
  const [datePart, timePart] = value.trim().split(/\s+/, 2);
  const [day, month, year] = datePart.split("/").map((part) => Number(part));
  if (!day || !month || !year) return Date.now();
  const [hour = 12, minute = 0] = (timePart ?? "")
    .split(":")
    .map((part) => Number(part));
  return new Date(year, month - 1, day, hour || 12, minute || 0).getTime();
}

async function enrichPost(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  currentClerkId: string,
  currentEmail?: string | null,
) {
  const imageUrls = (
    await Promise.all(post.images.map((image) => ctx.storage.getUrl(image)))
  ).filter((value): value is string => Boolean(value));
  const videoUrls = (
    await Promise.all((post.videos ?? []).map((video) => ctx.storage.getUrl(video)))
  ).filter((value): value is string => Boolean(value));

  const [comments, likes] = await Promise.all([
    ctx.db
      .query("postComments")
      .withIndex("by_postId", (q) => q.eq("postId", post._id))
      .collect(),
    ctx.db
      .query("postLikes")
      .withIndex("by_postId", (q) => q.eq("postId", post._id))
      .collect(),
  ]);

  const commentsWithMeta = comments
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((comment) => ({
      ...comment,
      canRemove:
        comment.authorClerkId === currentClerkId || post.authorClerkId === currentClerkId,
    }));
  const latestLike = [...likes].sort((a, b) => b.createdAt - a.createdAt)[0];
  const latestLikeName =
    latestLike?.clerkId === currentClerkId
      ? "Vous"
      : latestLike?.actorName ?? "Quelqu'un";

  return {
    ...post,
    imageUrls,
    videoUrls,
    comments: commentsWithMeta,
    likesCount: likes.length,
    latestLikeName: likes.length > 0 ? latestLikeName : undefined,
    likedByMe: likes.some((like) => like.clerkId === currentClerkId),
    commentsCount: commentsWithMeta.length,
    canManage: post.authorClerkId === currentClerkId || canEditAnyPost(currentEmail),
  };
}

export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const limit = Math.min(Math.max(Math.floor(args.limit ?? 50), 1), 100);
    const posts = await ctx.db.query("posts").order("desc").take(limit);
    const sorted = posts.sort((a, b) => {
      const pinA = a.pinned ? 1 : 0;
      const pinB = b.pinned ? 1 : 0;
      if (pinA !== pinB) return pinB - pinA;
      return b.createdAt - a.createdAt;
    });

    return await Promise.all(
      sorted.map((post) => enrichPost(ctx, post, identity.subject, identity.email)),
    );
  },
});

export const listLikes = query({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "read");
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post introuvable.");
    const likes = await ctx.db
      .query("postLikes")
      .withIndex("by_postId", (q) => q.eq("postId", args.postId))
      .order("desc")
      .take(200);

    return likes.map((like) => ({
      _id: like._id,
      name: like.actorName ?? "Utilisateur",
      imageUrl: like.actorImageUrl,
      createdAt: like.createdAt,
    }));
  },
});

export const create = mutation({
  args: {
    title: v.optional(v.string()),
    body: v.string(),
    images: v.optional(v.array(v.id("_storage"))),
    videos: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    if (args.videos?.length) {
      throw new Error("Les vidéos ne sont plus acceptées dans les publications.");
    }
    const body = args.body.trim();
    const title = args.title?.trim();
    if (!title && !body && !(args.images?.length ?? 0)) {
      throw new Error("Le post est vide.");
    }

    return await ctx.db.insert("posts", {
      authorClerkId: identity.subject,
      authorName: displayName(identity),
      authorImageUrl:
        (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined,
      title,
      body,
      images: args.images ?? [],
      videos: args.videos ?? [],
      pinned: false,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    postId: v.id("posts"),
    title: v.optional(v.string()),
    body: v.string(),
    images: v.optional(v.array(v.id("_storage"))),
    videos: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post introuvable.");
    if (post.authorClerkId !== identity.subject && !canEditAnyPost(identity.email)) {
      throw new Error("Modification non autorisée.");
    }
    if (args.videos?.length) {
      throw new Error("Les vidéos ne sont plus acceptées dans les publications.");
    }
    const body = args.body.trim();
    const title = args.title?.trim() || undefined;
    const images = args.images ?? post.images;
    const videos: Id<"_storage">[] = [];
    if (!title && !body && images.length === 0) {
      throw new Error("Le post est vide.");
    }
    // Libère les fichiers retirés du post (sinon ils restent orphelins).
    const kept = new Set<Id<"_storage">>([...images, ...videos]);
    await deleteStorageFiles(
      ctx,
      [...post.images, ...(post.videos ?? [])].filter((id) => !kept.has(id)),
    );
    await ctx.db.patch(args.postId, { title, body, images, videos, editedAt: Date.now() });
  },
});

export const importAirtablePosts = internalMutation({
  args: {
    rows: v.array(
      v.object({
        ref: v.string(),
        authorName: v.string(),
        title: v.optional(v.string()),
        body: v.string(),
        createdAt: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const result = {
      imported: 0,
      skippedExisting: 0,
      skippedMissingAuthor: [] as string[],
      skippedEmpty: 0,
    };

    for (const row of args.rows) {
      const ref = row.ref.trim();
      const body = row.body.trim();
      const title = row.title?.trim() || undefined;
      if (!ref || (!title && !body)) {
        result.skippedEmpty += 1;
        continue;
      }

      const existing = await ctx.db
        .query("posts")
        .withIndex("by_migrationSourceRef", (q) => q.eq("migrationSourceRef", ref))
        .unique();
      if (existing) {
        result.skippedExisting += 1;
        continue;
      }

      const authorKey = normalizePersonKey(row.authorName);
      const email = AIRTABLE_AUTHOR_EMAILS[authorKey];
      const author = email ? await getUserByEmail(ctx, email) : null;
      const fallback = AIRTABLE_AUTHOR_FALLBACKS[authorKey];
      if (!author && !fallback) {
        result.skippedMissingAuthor.push(row.authorName);
        continue;
      }

      await ctx.db.insert("posts", {
        authorClerkId: author?.clerkId ?? fallback.clerkId,
        authorName:
          [author?.firstName, author?.lastName].filter(Boolean).join(" ").trim() ||
          fallback?.authorName ||
          row.authorName,
        authorImageUrl: author?.imageUrl ?? fallback?.authorImageUrl,
        title,
        body,
        images: [],
        videos: [],
        pinned: false,
        createdAt: dateFromAirtable(row.createdAt),
        migrationSourceRef: ref,
      });
      result.imported += 1;
    }

    return {
      ...result,
      skippedMissingAuthor: [...new Set(result.skippedMissingAuthor)],
    };
  },
});

/** Supprime des fichiers du storage en ignorant ceux déjà absents. */
async function deleteStorageFiles(ctx: MutationCtx, ids: Id<"_storage">[]) {
  await Promise.all(
    ids.map(async (id) => {
      try {
        await ctx.storage.delete(id);
      } catch {
        // Fichier déjà supprimé : rien à faire.
      }
    }),
  );
}

export const addComment = mutation({
  args: {
    postId: v.id("posts"),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post introuvable.");
    const body = args.body.trim();
    if (!body) throw new Error("Commentaire vide.");

    const commentId = await ctx.db.insert("postComments", {
      postId: args.postId,
      authorClerkId: identity.subject,
      authorName: displayName(identity),
      authorImageUrl:
        (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined,
      body,
      createdAt: Date.now(),
    });
    if (post.authorClerkId !== identity.subject) {
      await createMesoutilsNotification(ctx, {
        recipientClerkId: post.authorClerkId,
        kind: "post_commented",
        title: `${displayName(identity)} a commenté votre post`,
        body,
        actorName: displayName(identity),
        actorImageUrl: (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined,
        href: "/actualites?v=publications",
      });
    }
    return commentId;
  },
});

export const removeComment = mutation({
  args: {
    commentId: v.id("postComments"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return;
    const post = await ctx.db.get(comment.postId);
    const isOwner = comment.authorClerkId === identity.subject;
    const isPostAuthor = post?.authorClerkId === identity.subject;
    const isManager = await (async () => {
      try {
        await requireCrmPermission(ctx, POSTS_PAGE_KEY, "manage");
        return true;
      } catch {
        return false;
      }
    })();
    if (!isOwner && !isPostAuthor && !isManager) {
      throw new Error("Suppression non autorisée.");
    }
    await ctx.db.delete(args.commentId);
  },
});

export const toggleLike = mutation({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const existing = await ctx.db
      .query("postLikes")
      .withIndex("by_post_and_user", (q) =>
        q.eq("postId", args.postId).eq("clerkId", identity.subject),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { liked: false };
    }
    await ctx.db.insert("postLikes", {
      postId: args.postId,
      clerkId: identity.subject,
      actorName: displayName(identity),
      actorImageUrl:
        (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined,
      createdAt: Date.now(),
    });
    const post = await ctx.db.get(args.postId);
    if (post && post.authorClerkId !== identity.subject) {
      await createMesoutilsNotification(ctx, {
        recipientClerkId: post.authorClerkId,
        kind: "post_liked",
        title: `${displayName(identity)} a liké votre post`,
        body: post.body
          ? post.body.slice(0, 120)
          : (post.videos?.length ?? 0) > 0
            ? "Publication avec vidéo"
            : "Publication avec photo",
        actorName: displayName(identity),
        actorImageUrl: (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined,
        href: "/actualites?v=publications",
      });
    }
    return { liked: true };
  },
});

export const remove = mutation({
  args: {
    postId: v.id("posts"),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "manage");
    const post = await ctx.db.get(args.postId);
    if (!post) return;

    const [comments, likes] = await Promise.all([
      ctx.db
        .query("postComments")
        .withIndex("by_postId", (q) => q.eq("postId", args.postId))
        .collect(),
      ctx.db
        .query("postLikes")
        .withIndex("by_postId", (q) => q.eq("postId", args.postId))
        .collect(),
    ]);

    await Promise.all([
      ...comments.map((comment) => ctx.db.delete(comment._id)),
      ...likes.map((like) => ctx.db.delete(like._id)),
    ]);
    // Libère aussi les fichiers du post (images + vidéos).
    await deleteStorageFiles(ctx, [...post.images, ...(post.videos ?? [])]);
    await ctx.db.delete(args.postId);
  },
});

/**
 * Maintenance : retire toutes les vidéos des posts et supprime leurs fichiers
 * du storage (les vidéos servies depuis Convex explosent le data egress).
 * À lancer via `npx convex run posts:removeAllPostVideos`.
 */
export const removeAllPostVideos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const posts = await ctx.db.query("posts").collect();
    let removedFiles = 0;
    let touchedPosts = 0;
    for (const post of posts) {
      const videos = post.videos ?? [];
      if (videos.length === 0) continue;
      await deleteStorageFiles(ctx, videos);
      await ctx.db.patch(post._id, { videos: [] });
      removedFiles += videos.length;
      touchedPosts += 1;
    }
    return { touchedPosts, removedFiles };
  },
});

export const pin = mutation({
  args: {
    postId: v.id("posts"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "manage");
    await ctx.db.patch(args.postId, {
      pinned: args.pinned,
      editedAt: Date.now(),
    });
  },
});
