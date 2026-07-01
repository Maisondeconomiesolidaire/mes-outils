import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireUser } from "./lib";

export async function createMesoutilsNotification(
  ctx: MutationCtx,
  args: {
    recipientClerkId?: string;
    kind: "room_reservation_confirmed" | "vehicle_reservation_decided" | "new_direct_message" | "post_liked" | "post_commented" | "deal_interest" | "vehicle_reservation_request";
    title: string;
    body?: string;
    actorName?: string;
    actorImageUrl?: string;
    assetImageUrl?: string;
    href?: string;
  },
) {
  const recipientClerkId = args.recipientClerkId?.trim();
  if (!recipientClerkId) return null;
  return await ctx.db.insert("mesoutilsNotifications", {
    recipientClerkId,
    kind: args.kind,
    title: args.title.trim(),
    body: args.body?.trim() || undefined,
    actorName: args.actorName?.trim() || undefined,
    actorImageUrl: args.actorImageUrl?.trim() || undefined,
    assetImageUrl: args.assetImageUrl?.trim() || undefined,
    href: args.href,
    read: false,
    createdAt: Date.now(),
  });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    return await ctx.db
      .query("mesoutilsNotifications")
      .withIndex("by_recipient_createdAt", (q) => q.eq("recipientClerkId", identity.subject))
      .order("desc")
      .take(100);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const unread = await ctx.db
      .query("mesoutilsNotifications")
      .withIndex("by_recipient_read_createdAt", (q) =>
        q.eq("recipientClerkId", identity.subject).eq("read", false),
      )
      .collect();
    return unread.length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("mesoutilsNotifications") },
  handler: async (ctx, args) => {
    const identity = await requireUser(ctx);
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification.recipientClerkId !== identity.subject) return;
    await ctx.db.patch(args.notificationId, { read: true });
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const unread = await ctx.db
      .query("mesoutilsNotifications")
      .withIndex("by_recipient_read_createdAt", (q) =>
        q.eq("recipientClerkId", identity.subject).eq("read", false),
      )
      .collect();
    await Promise.all(unread.map((notification) => ctx.db.patch(notification._id, { read: true })));
  },
});
