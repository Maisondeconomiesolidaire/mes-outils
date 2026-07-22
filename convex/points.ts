import { v } from "convex/values";
import { action, env, internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { fetchInternalClerkDirectory, requireUser } from "./lib";

export const INITIAL_POINTS = 100;
export const ENGAGEMENT_POINTS = 100;

function nameFor(identity: { name?: string | null; givenName?: string | null; familyName?: string | null; email?: string | null }) {
  return identity.givenName?.trim() || identity.name?.trim() || identity.familyName?.trim() || identity.email?.trim() || "Utilisateur";
}

/** Attribution idempotente, utilisable par les mutations métier du backend partagé. */
export async function awardEngagementPoints(ctx: MutationCtx, args: { clerkId: string; displayName: string; eventKey: string }) {
  const existingAward = await ctx.db.query("userPointAwards").withIndex("by_clerkId_and_eventKey", (q) => q.eq("clerkId", args.clerkId).eq("eventKey", args.eventKey)).unique();
  if (existingAward) return;
  const now = Date.now();
  const account = await ctx.db.query("userPoints").withIndex("by_clerkId", (q) => q.eq("clerkId", args.clerkId)).unique();
  if (account) await ctx.db.patch(account._id, { displayName: args.displayName || account.displayName, points: account.points + ENGAGEMENT_POINTS, updatedAt: now });
  else await ctx.db.insert("userPoints", { clerkId: args.clerkId, displayName: args.displayName || "Utilisateur", points: INITIAL_POINTS + ENGAGEMENT_POINTS, updatedAt: now });
  await ctx.db.insert("userPointAwards", { clerkId: args.clerkId, eventKey: args.eventKey, points: ENGAGEMENT_POINTS, createdAt: now });
}

export const myPoints = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const account = await ctx.db.query("userPoints").withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject)).unique();
    return account?.points ?? INITIAL_POINTS;
  },
});

export const ensureMine = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const current = await ctx.db.query("userPoints").withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject)).unique();
    if (current) return current.points;
    await ctx.db.insert("userPoints", { clerkId: identity.subject, displayName: nameFor(identity), points: INITIAL_POINTS, updatedAt: Date.now() });
    return INITIAL_POINTS;
  },
});

export const leaderboard = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("userPoints").withIndex("by_points").order("desc").take(100);
    return rows.map((row, index) => ({ rank: index + 1, displayName: row.displayName, points: row.points }));
  },
});

export const syncLeaderboardDirectory = action({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.runQuery(api.points.assertSignedIn, {});
    const secret = env.CLERK_SECRET_KEY;
    if (!secret) throw new Error("Annuaire indisponible.");
    const directory = await fetchInternalClerkDirectory(secret, identity.email ?? "");
    directory.push({ clerkId: identity.subject, name: nameFor(identity), imageUrl: null });
    await ctx.runMutation(internal.points.syncHistorical, { directory: directory.map(({ clerkId, name }) => ({ clerkId, name })) });
    return null;
  },
});

export const assertSignedIn = query({ args: {}, handler: async (ctx) => await requireUser(ctx) });

export const syncHistorical = internalMutation({
  args: { directory: v.array(v.object({ clerkId: v.string(), name: v.string() })) },
  handler: async (ctx, { directory }) => {
    const names = new Map(directory.map((entry) => [entry.clerkId, entry.name]));
    for (const entry of directory) {
      const current = await ctx.db.query("userPoints").withIndex("by_clerkId", (q) => q.eq("clerkId", entry.clerkId)).unique();
      if (!current) await ctx.db.insert("userPoints", { clerkId: entry.clerkId, displayName: entry.name, points: INITIAL_POINTS, updatedAt: Date.now() });
    }
    const rooms = await ctx.db.query("roomReservations").take(1000);
    for (const row of rooms) await awardEngagementPoints(ctx, { clerkId: row.bookedForClerkId ?? row.clerkId, displayName: row.userName, eventKey: `room-reservation:${row._id}` });
    const vehicles = await ctx.db.query("vehicleReservations").take(1000);
    for (const row of vehicles) {
      const clerkId = row.bookedForClerkId ?? row.clerkId;
      await awardEngagementPoints(ctx, { clerkId, displayName: row.userName, eventKey: `vehicle-reservation:${row._id}` });
      if (row.feedbackSubmittedAt) await awardEngagementPoints(ctx, { clerkId, displayName: names.get(clerkId) ?? row.userName, eventKey: `vehicle-return:${row._id}` });
    }
    const feedback = await ctx.db.query("feedback").take(1000);
    for (const row of feedback) await awardEngagementPoints(ctx, { clerkId: row.authorClerkId, displayName: row.authorName ?? names.get(row.authorClerkId) ?? "Utilisateur", eventKey: `feedback:${row._id}` });
  },
});
