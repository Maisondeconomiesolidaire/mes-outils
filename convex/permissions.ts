import { v } from "convex/values";
import { action, env, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  getCrmAccessForIdentity,
  hasCrmPermission,
  isAdminIdentity,
  isStaffIdentity,
  requireAdmin,
  requireUser,
} from "./lib";

const grantValidator = v.object({
  pageKey: v.string(),
  actions: v.array(v.string()),
});

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeGrants(grants: { pageKey: string; actions: string[] }[]) {
  return grants
    .map((grant) => ({
      pageKey: grant.pageKey.trim(),
      actions: Array.from(
        new Set(grant.actions.map((action) => action.trim()).filter(Boolean)),
      ),
    }))
    .filter((grant) => grant.pageKey && grant.actions.length > 0);
}

async function requirePermissionManager(ctx: Parameters<typeof requireAdmin>[0]) {
  const identity = await requireUser(ctx);
  if (isAdminIdentity(identity)) return identity;
  if ("db" in ctx && await hasCrmPermission(ctx, "mesoutils:admin", "manage")) {
    return identity;
  }
  throw new Error("Accès réservé aux administrateurs.");
}

export const myAccess = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    const access = await getCrmAccessForIdentity(ctx, identity);

    return {
      role: access.admin ? "admin" : access.staff ? "staff" : "none",
      isStaff: access.staff,
      isAdmin: access.admin,
      email: access.email,
      bootstrapMode: access.bootstrapMode,
      grants: access.grants,
    };
  },
});

export const canManagePermissions = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requirePermissionManager(ctx);
    return true;
  },
});

export const listManaged = query({
  args: {},
  handler: async (ctx) => {
    await requirePermissionManager(ctx);
    const permissionRecords = await ctx.db
      .query("crmPermissions")
      .order("desc")
      .take(300);

    return {
      people: permissionRecords
        .map((record) => ({
          email: record.email,
          name: record.name,
          permissionActive: record.active,
          grants: record.grants,
          updatedAt: record.updatedAt,
        }))
        .sort((a, b) =>
          (a.name ?? a.email).localeCompare(b.name ?? b.email, "fr"),
        ),
    };
  },
});

type ClerkEmailAddress = {
  id?: unknown;
  email_address?: unknown;
};

type ClerkUserPayload = {
  id?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  username?: unknown;
  image_url?: unknown;
  primary_email_address_id?: unknown;
  email_addresses?: unknown;
  public_metadata?: unknown;
  created_at?: unknown;
  last_sign_in_at?: unknown;
};

const roleValidator = v.union(
  v.literal("client"),
  v.literal("staff"),
  v.literal("admin"),
);

type CrmRole = "client" | "staff" | "admin";

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roleFromMetadata(value: unknown): CrmRole {
  if (!value || typeof value !== "object") return "client";
  const role = (value as { role?: unknown }).role;
  return role === "staff" || role === "admin" ? role : "client";
}

function clerkPrimaryEmail(user: ClerkUserPayload) {
  const emails = Array.isArray(user.email_addresses)
    ? (user.email_addresses as ClerkEmailAddress[])
    : [];
  const primaryId = stringOrNull(user.primary_email_address_id);
  const primary = emails.find((email) => email.id === primaryId) ?? emails[0];
  return stringOrNull(primary?.email_address)?.toLowerCase() ?? null;
}

function normalizeClerkUser(user: ClerkUserPayload) {
  const email = clerkPrimaryEmail(user);
  if (!email) return null;
  const firstName = stringOrNull(user.first_name);
  const lastName = stringOrNull(user.last_name);
  const name = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    clerkId: stringOrNull(user.id) ?? email,
    email,
    name: name || stringOrNull(user.username) || email,
    role: roleFromMetadata(user.public_metadata),
    imageUrl: stringOrNull(user.image_url),
    createdAt: numberOrNull(user.created_at),
    lastSignInAt: numberOrNull(user.last_sign_in_at),
  };
}

export const listClerkUsers = action({
  args: {
    limit: v.optional(v.number()),
    query: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.permissions.canManagePermissions);
    const secretKey = env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return {
        users: [],
        totalCount: 0,
        setupError: "missing_clerk_secret_key",
      };
    }

    const limit = Math.min(Math.max(Math.floor(args.limit ?? 200), 1), 500);
    const url = new URL("https://api.clerk.com/v1/users");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", "0");
    url.searchParams.set("order_by", "-created_at");
    if (args.query?.trim()) {
      url.searchParams.set("query", args.query.trim());
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return {
        users: [],
        totalCount: 0,
        setupError: `clerk_api_${response.status}`,
      };
    }

    const payload: unknown = await response.json();
    const rawUsers = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown }).data)
        ? (payload as { data: unknown[] }).data
        : [];
    const totalCount = Array.isArray(payload)
      ? rawUsers.length
      : typeof (payload as { total_count?: unknown }).total_count === "number"
        ? (payload as { total_count: number }).total_count
        : typeof (payload as { totalCount?: unknown }).totalCount === "number"
          ? (payload as { totalCount: number }).totalCount
          : rawUsers.length;

    return {
      users: rawUsers
        .map((user) => normalizeClerkUser(user as ClerkUserPayload))
        .filter((user): user is NonNullable<ReturnType<typeof normalizeClerkUser>> =>
          Boolean(user),
        ),
      totalCount,
      setupError: null,
    };
  },
});

export const updateClerkRole = action({
  args: {
    clerkId: v.string(),
    role: roleValidator,
  },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.permissions.canManagePermissions);
    const secretKey = env.CLERK_SECRET_KEY;
    if (!secretKey) {
      return { ok: false, setupError: "missing_clerk_secret_key" };
    }

    const response = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(args.clerkId)}/metadata`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_metadata: {
            role: args.role,
          },
        }),
      },
    );

    if (!response.ok) {
      return { ok: false, setupError: `clerk_api_${response.status}` };
    }

    return { ok: true, setupError: null };
  },
});

export const upsert = mutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    active: v.boolean(),
    grants: v.array(grantValidator),
  },
  handler: async (ctx, args) => {
    const admin = await requirePermissionManager(ctx);
    const email = normalizeEmail(args.email);
    if (!email) throw new Error("Email requis.");

    const existing = await ctx.db
      .query("crmPermissions")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const payload = {
      email,
      name: args.name?.trim() || undefined,
      active: args.active,
      grants: normalizeGrants(args.grants),
      updatedAt: Date.now(),
      updatedBy: admin.email ?? admin.tokenIdentifier,
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }

    return await ctx.db.insert("crmPermissions", {
      ...payload,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    await requirePermissionManager(ctx);
    const email = normalizeEmail(args.email);
    const existing = await ctx.db
      .query("crmPermissions")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const debugRole = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireUser(ctx);
    return {
      email: identity.email ?? null,
      isStaff: isStaffIdentity(identity),
      isAdmin: isAdminIdentity(identity),
    };
  },
});
