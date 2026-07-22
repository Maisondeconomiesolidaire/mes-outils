import { mutation, query, type MutationCtx } from "./_generated/server";
import { requireUser } from "./lib";

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
