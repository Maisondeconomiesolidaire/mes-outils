import { v } from "convex/values";
import { action, env, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCrmPermission, requireStaff, requireUser } from "./lib";

const PAGE_KEY = "mesoutils:actualites";

const dealType = v.union(
  v.literal("pret"),
  v.literal("don"),
  v.literal("vente"),
  v.literal("echange"),
);

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

function pictureUrl(identity: unknown) {
  return (identity as { pictureUrl?: string | null }).pictureUrl ?? undefined;
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("__");
}

async function resolveImages(ctx: QueryCtx | MutationCtx, images: Id<"_storage">[] | undefined) {
  if (!images?.length) return [];
  const urls = await Promise.all(images.map((id) => ctx.storage.getUrl(id)));
  return urls.filter((value): value is string => Boolean(value));
}

/* ─── Événements ─────────────────────────────────────────────────────────── */

export const listEvents = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const events = await ctx.db.query("events").withIndex("by_start").order("desc").take(100);
    return await Promise.all(
      events.map(async (event) => ({
        ...event,
        imageUrls: await resolveImages(ctx, event.images),
        canManage: event.authorClerkId === identity.subject,
      })),
    );
  },
});

export const createEvent = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    start: v.number(),
    end: v.optional(v.number()),
    images: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    if (!args.title.trim()) throw new Error("Titre requis.");
    return await ctx.db.insert("events", {
      authorClerkId: identity.subject,
      authorName: displayName(identity),
      authorImageUrl: pictureUrl(identity),
      title: args.title.trim(),
      description: args.description?.trim() || undefined,
      location: args.location?.trim() || undefined,
      start: args.start,
      end: args.end,
      images: args.images ?? [],
      createdAt: Date.now(),
    });
  },
});

export const removeEvent = mutation({
  args: { eventId: v.id("events") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event) return;
    const isManager = await canManage(ctx);
    if (event.authorClerkId !== identity.subject && !isManager) {
      throw new Error("Suppression non autorisée.");
    }
    await ctx.db.delete(args.eventId);
  },
});

/* ─── Bons plans ─────────────────────────────────────────────────────────── */

export const listDeals = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const deals = await ctx.db.query("dealPosts").withIndex("by_createdAt").order("desc").take(100);
    return await Promise.all(
      deals.map(async (deal) => ({
        ...deal,
        imageUrls: await resolveImages(ctx, deal.images),
        canManage: deal.authorClerkId === identity.subject,
        isMine: deal.authorClerkId === identity.subject,
      })),
    );
  },
});

export const createDeal = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    dealType,
    price: v.optional(v.number()),
    availableFrom: v.optional(v.number()),
    availableTo: v.optional(v.number()),
    images: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    if (!args.title.trim()) throw new Error("Titre requis.");
    return await ctx.db.insert("dealPosts", {
      authorClerkId: identity.subject,
      authorName: displayName(identity),
      authorImageUrl: pictureUrl(identity),
      title: args.title.trim(),
      description: args.description.trim(),
      dealType: args.dealType,
      price: args.price,
      availableFrom: args.availableFrom,
      availableTo: args.availableTo,
      images: args.images ?? [],
      status: "open",
      createdAt: Date.now(),
    });
  },
});

export const setDealStatus = mutation({
  args: {
    dealId: v.id("dealPosts"),
    status: v.union(v.literal("open"), v.literal("closed")),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const deal = await ctx.db.get(args.dealId);
    if (!deal) return;
    if (deal.authorClerkId !== identity.subject && !(await canManage(ctx))) {
      throw new Error("Action non autorisée.");
    }
    await ctx.db.patch(args.dealId, { status: args.status });
  },
});

export const removeDeal = mutation({
  args: { dealId: v.id("dealPosts") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const identity = await requireUser(ctx);
    const deal = await ctx.db.get(args.dealId);
    if (!deal) return;
    if (deal.authorClerkId !== identity.subject && !(await canManage(ctx))) {
      throw new Error("Suppression non autorisée.");
    }
    await ctx.db.delete(args.dealId);
  },
});

/* ─── Messagerie interne ─────────────────────────────────────────────────── */

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireStaff(ctx);
    const me = identity.subject;

    const [received, sent] = await Promise.all([
      ctx.db.query("directMessages").withIndex("by_to", (q) => q.eq("toClerkId", me)).collect(),
      ctx.db.query("directMessages").withIndex("by_from", (q) => q.eq("fromClerkId", me)).collect(),
    ]);

    const byCounterpart = new Map<
      string,
      { clerkId: string; name: string; imageUrl?: string; lastBody: string; lastAt: number; unread: number }
    >();

    for (const message of [...received, ...sent]) {
      const isIncoming = message.toClerkId === me;
      const counterpartId = isIncoming ? message.fromClerkId : message.toClerkId;
      const counterpartName = isIncoming ? message.fromName : message.toName;
      const counterpartImage = isIncoming ? message.fromImageUrl : undefined;
      const existing = byCounterpart.get(counterpartId);
      const unreadInc = isIncoming && !message.readAt ? 1 : 0;
      if (!existing || message.createdAt > existing.lastAt) {
        byCounterpart.set(counterpartId, {
          clerkId: counterpartId,
          name: counterpartName,
          imageUrl: counterpartImage ?? existing?.imageUrl,
          lastBody: message.body,
          lastAt: message.createdAt,
          unread: (existing?.unread ?? 0) + unreadInc,
        });
      } else {
        existing.unread += unreadInc;
        if (counterpartImage && !existing.imageUrl) existing.imageUrl = counterpartImage;
      }
    }

    return Array.from(byCounterpart.values()).sort((a, b) => b.lastAt - a.lastAt);
  },
});

export const listThread = query({
  args: { otherClerkId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    const key = pairKey(identity.subject, args.otherClerkId);
    const messages = await ctx.db
      .query("directMessages")
      .withIndex("by_pair", (q) => q.eq("pairKey", key))
      .collect();
    return messages
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((message) => ({ ...message, mine: message.fromClerkId === identity.subject }));
  },
});

export const sendMessage = mutation({
  args: {
    toClerkId: v.string(),
    toName: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    const body = args.body.trim();
    if (!body) throw new Error("Message vide.");
    if (args.toClerkId === identity.subject) throw new Error("Destinataire invalide.");
    return await ctx.db.insert("directMessages", {
      pairKey: pairKey(identity.subject, args.toClerkId),
      fromClerkId: identity.subject,
      fromName: displayName(identity),
      fromImageUrl: pictureUrl(identity),
      toClerkId: args.toClerkId,
      toName: args.toName.trim() || "Utilisateur",
      body,
      createdAt: Date.now(),
    });
  },
});

export const markThreadRead = mutation({
  args: { otherClerkId: v.string() },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    const key = pairKey(identity.subject, args.otherClerkId);
    const messages = await ctx.db
      .query("directMessages")
      .withIndex("by_pair", (q) => q.eq("pairKey", key))
      .collect();
    const now = Date.now();
    await Promise.all(
      messages
        .filter((message) => message.toClerkId === identity.subject && !message.readAt)
        .map((message) => ctx.db.patch(message._id, { readAt: now })),
    );
  },
});

/* ─── Annuaire staff (pour réserver au nom d'un collègue) ────────────────── */

type ClerkDirectoryUser = {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
  image_url?: unknown;
  email_addresses?: unknown;
};

export const listStaffDirectory = action({
  args: {},
  handler: async (ctx): Promise<Array<{ clerkId: string; name: string; imageUrl: string | null }>> => {
    await requireStaff(ctx);
    const secretKey = env.CLERK_SECRET_KEY;
    if (!secretKey) return [];

    const url = new URL("https://api.clerk.com/v1/users");
    url.searchParams.set("limit", "200");
    url.searchParams.set("order_by", "last_name");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
    });
    if (!response.ok) return [];

    const payload: unknown = await response.json();
    const raw = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];

    return raw
      .map((entry) => {
        const user = entry as ClerkDirectoryUser;
        const clerkId = typeof user.id === "string" ? user.id : null;
        if (!clerkId) return null;
        const first = typeof user.first_name === "string" ? user.first_name : "";
        const last = typeof user.last_name === "string" ? user.last_name : "";
        const username = typeof user.username === "string" ? user.username : "";
        const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
        const email =
          emails.length > 0 && typeof (emails[0] as { email_address?: unknown }).email_address === "string"
            ? ((emails[0] as { email_address: string }).email_address)
            : "";
        const name = [first, last].filter(Boolean).join(" ").trim() || username || email || "Utilisateur";
        return { clerkId, name, imageUrl: typeof user.image_url === "string" ? user.image_url : null };
      })
      .filter((value): value is { clerkId: string; name: string; imageUrl: string | null } => Boolean(value))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

async function canManage(ctx: QueryCtx | MutationCtx) {
  try {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    return true;
  } catch {
    return false;
  }
}
