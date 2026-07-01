import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCrmPermission, requireUser } from "./lib";
import { createMesoutilsNotification } from "./mesoutilsNotifications";

const POSTS_PAGE_KEY = "mesoutils:actualites";

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

async function enrichPost(
  ctx: QueryCtx | MutationCtx,
  post: Doc<"posts">,
  currentClerkId: string,
) {
  const imageUrls = (
    await Promise.all(post.images.map((image) => ctx.storage.getUrl(image)))
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
    comments: commentsWithMeta,
    likesCount: likes.length,
    latestLikeName: likes.length > 0 ? latestLikeName : undefined,
    likedByMe: likes.some((like) => like.clerkId === currentClerkId),
    commentsCount: commentsWithMeta.length,
    canManage: post.authorClerkId === currentClerkId,
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
      sorted.map((post) => enrichPost(ctx, post, identity.subject)),
    );
  },
});

export const create = mutation({
  args: {
    body: v.string(),
    images: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const body = args.body.trim();
    if (!body && !(args.images?.length ?? 0)) {
      throw new Error("Le post est vide.");
    }

    return await ctx.db.insert("posts", {
      authorClerkId: identity.subject,
      authorName: displayName(identity),
      authorImageUrl:
        (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined,
      body,
      images: args.images ?? [],
      pinned: false,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    postId: v.id("posts"),
    body: v.string(),
    images: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, POSTS_PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const post = await ctx.db.get(args.postId);
    if (!post) throw new Error("Post introuvable.");
    if (post.authorClerkId !== identity.subject) {
      throw new Error("Modification non autorisée.");
    }
    const body = args.body.trim();
    const images = args.images ?? post.images;
    if (!body && images.length === 0) {
      throw new Error("Le post est vide.");
    }
    await ctx.db.patch(args.postId, { body, images, editedAt: Date.now() });
  },
});

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
        body: post.body ? post.body.slice(0, 120) : "Publication avec photo",
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
    await ctx.db.delete(args.postId);
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
