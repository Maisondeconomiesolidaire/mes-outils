import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { UserIdentity } from "convex/server";

/**
 * Met en forme un nom/prénom : première lettre de chaque mot en majuscule,
 * le reste en minuscules. Gère les composés ("jean-pierre" → "Jean-Pierre",
 * "marie dupont" → "Marie Dupont", "DE LA TOUR" → "De La Tour").
 */
export function titleCaseName(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) =>
      sep + ch.toLocaleUpperCase("fr-FR"),
    );
}

/** Normalise les prénom/nom d'un objet client. */
export function normalizeCustomer<T extends { firstName: string; lastName: string }>(
  customer: T,
): T {
  return {
    ...customer,
    firstName: titleCaseName(customer.firstName),
    lastName: titleCaseName(customer.lastName),
  };
}

/** Formate un nom complet client de manière homogène. */
export function customerFullName(customer: {
  firstName?: string;
  lastName?: string;
}): string {
  return [customer.firstName, customer.lastName]
    .filter(Boolean)
    .map((part) => titleCaseName(part!))
    .join(" ")
    .trim();
}

/** Toute identité Clerk authentifiée (client ou staff). */
export async function requireUser(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Non authentifié.");
  }
  return identity;
}

function allowedEmailsFromEnv(name: string) {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function hasDb(ctx: QueryCtx | MutationCtx | ActionCtx): ctx is QueryCtx | MutationCtx {
  return "db" in ctx;
}

async function getActiveCrmPermissionRecord(
  ctx: QueryCtx | MutationCtx,
  email: string,
) {
  const record = await ctx.db
    .query("crmPermissions")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  return record?.active ? record : null;
}

/**
 * Détermine si une identité Clerk correspond à un membre du staff.
 *
 * Mécanisme principal : le rôle exposé par Clerk (`publicMetadata.role`),
 * disponible dans le token Convex si le template JWT « convex » inclut
 *   "role": "{{user.public_metadata.role}}".
 *
 * Filet de sécurité (« break-glass ») : la variable d'environnement Convex
 * STAFF_EMAILS (emails séparés par des virgules) évite que le staff soit
 * verrouillé hors du CRM tant que le claim de rôle n'est pas configuré.
 */
export function isStaffIdentity(identity: UserIdentity): boolean {
  const role = (identity as { role?: unknown }).role;
  if (role === "staff" || isAdminIdentity(identity)) return true;

  const allow = allowedEmailsFromEnv("STAFF_EMAILS");
  const email = identity.email?.toLowerCase();
  return Boolean(email && allow.includes(email));
}

export function isAdminIdentity(identity: UserIdentity): boolean {
  const role = (identity as { role?: unknown }).role;
  if (role === "admin") return true;

  const allow = allowedEmailsFromEnv("ADMIN_EMAILS");
  const email = identity.email?.toLowerCase();
  return Boolean(email && allow.includes(email));
}

/** Vérifie qu'une session Clerk *staff* est présente (CRM). */
export async function requireStaff(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await requireUser(ctx);
  if (isStaffIdentity(identity)) return identity;

  const email = identity.email?.trim().toLowerCase();
  if (email && hasDb(ctx)) {
    const record = await getActiveCrmPermissionRecord(ctx, email);
    if (record) return identity;
  }

  throw new Error("Accès réservé au personnel.");
}

/** Vérifie qu'une session Clerk admin est présente. */
export async function requireAdmin(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await requireUser(ctx);
  if (!isAdminIdentity(identity)) {
    throw new Error("Accès réservé aux administrateurs.");
  }
  return identity;
}

export type CrmPermissionAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "manage"
  | "reply"
  | "share"
  | "checkout"
  | "print"
  | "analyze"
  | "start";

export async function getCrmAccessForIdentity(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
) {
  const admin = isAdminIdentity(identity);
  const email = identity.email?.trim().toLowerCase() ?? null;

  if (admin) {
    return { staff: true, admin: true, email, bootstrapMode: false, grants: [] };
  }

  const record = email ? await getActiveCrmPermissionRecord(ctx, email) : null;
  const staff = isStaffIdentity(identity) || Boolean(record);

  if (!staff) {
    return { staff: false, admin: false, email, bootstrapMode: false, grants: [] };
  }

  if (!email) {
    return { staff: true, admin: false, email, bootstrapMode: false, grants: [] };
  }

  return {
    staff: true,
    admin: false,
    email,
    bootstrapMode: false,
    grants: record?.grants ?? [],
  };
}

export async function hasCrmPermission(
  ctx: QueryCtx | MutationCtx,
  pageKey: string,
  action: CrmPermissionAction = "read",
) {
  const identity = await requireUser(ctx);
  const access = await getCrmAccessForIdentity(ctx, identity);
  if (access.admin || access.bootstrapMode) return true;
  if (!access.staff) return false;
  const grant = access.grants.find((entry) => entry.pageKey === pageKey);
  return Boolean(grant?.actions.includes(action));
}

export async function requireCrmPermission(
  ctx: QueryCtx | MutationCtx,
  pageKey: string,
  action: CrmPermissionAction = "read",
) {
  const allowed = await hasCrmPermission(ctx, pageKey, action);
  if (!allowed) {
    throw new Error("Accès CRM insuffisant.");
  }
}

/**
 * Vérification pure (sans ctx) à partir d'un objet d'accès — utile dans les
 * actions, qui n'ont pas accès à la base et passent par `permissions.myAccess`.
 */
export function accessAllows(
  access: {
    isAdmin?: boolean;
    bootstrapMode?: boolean;
    grants: Array<{ pageKey: string; actions: string[] }>;
  },
  pageKey: string,
  action: CrmPermissionAction = "read",
) {
  if (access.isAdmin || access.bootstrapMode) return true;
  return Boolean(
    access.grants.find((grant) => grant.pageKey === pageKey)?.actions.includes(action),
  );
}

/** Autorise si l'utilisateur détient au moins une des permissions listées. */
export async function requireAnyCrmPermission(
  ctx: QueryCtx | MutationCtx,
  checks: Array<[string, CrmPermissionAction]>,
) {
  for (const [pageKey, action] of checks) {
    if (await hasCrmPermission(ctx, pageKey, action)) return;
  }
  throw new Error("Accès CRM insuffisant.");
}

/**
 * Accès à une ressource rattachée à une demande (messagerie, documents…) :
 * autorisé si l'utilisateur a la permission CRM requise (= staff habilité)
 * OU s'il est le client propriétaire de la demande. Sinon, refus.
 */
export async function requireRequestParticipant(
  ctx: QueryCtx | MutationCtx,
  requestId: import("./_generated/dataModel").Id<"requests">,
  pageKey: string,
  action: CrmPermissionAction = "read",
) {
  const identity = await requireUser(ctx);
  const request = await ctx.db.get(requestId);
  if (!request) throw new Error("Demande introuvable.");
  const staff = await hasCrmPermission(ctx, pageKey, action);
  if (staff) return { identity, request, staff: true as const };
  if (request.userId && request.userId === identity.subject) {
    return { identity, request, staff: false as const };
  }
  throw new Error("Accès refusé à cette demande.");
}

type AerogommageItemInput = {
  objectType?: string;
  label?: string;
  height?: number;
  width?: number;
  depth?: number;
  quantity?: number;
  woodType?: string;
  stripping?: string;
  coating?: string;
  coatingOther?: string;
  delivery?: boolean;
  retrieval?: boolean;
  comment?: string;
};

type CollecteInput = {
  dismountable?: boolean;
  reusableGoodCondition?: boolean;
  sorted?: boolean;
  noWaste?: boolean;
  objectCategories?: string[];
  grosObjets?: string[];
  grosObjetsAutre?: string;
  petitsObjets?: string[];
  petitsObjetsAutre?: string;
  housingType?: string;
  floors?: number;
  dedicatedParking?: boolean;
  parkingDistance?: number;
  parkingUnknown?: boolean;
  largeItems?: string;
  furniture?: string;
  smallItems?: string;
  collectAddress?: {
    address?: string;
    postalCode?: string;
    city?: string;
  };
};

type CustomerInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address?: string;
  postalCode?: string;
  city?: string;
};

function customerComplete(c: CustomerInput): boolean {
  return Boolean(
    c.firstName?.trim() &&
      c.lastName?.trim() &&
      c.email?.trim() &&
      c.phone?.trim(),
  );
}

/**
 * Une demande est « complète » quand le client a renseigné tous les champs
 * requis selon son type. Calculé côté serveur au moment de l'envoi.
 */
export function isAerogommageComplete(
  customer: CustomerInput,
  items: AerogommageItemInput[],
): boolean {
  if (!customerComplete(customer)) return false;
  if (items.length === 0) return false;
  return items.every(
    (d) =>
      Boolean(d.objectType?.trim()) &&
      typeof d.height === "number" &&
      typeof d.width === "number" &&
      typeof d.depth === "number" &&
      Boolean(d.woodType?.trim()) &&
      Boolean(d.stripping?.trim()) &&
      Boolean(d.coating?.trim()),
  );
}

export function isCollecteComplete(
  customer: CustomerInput,
  d: CollecteInput,
): boolean {
  const hasItems = Boolean(
    (d.objectCategories && d.objectCategories.length > 0) ||
      (d.grosObjets && d.grosObjets.length > 0) ||
      (d.petitsObjets && d.petitsObjets.length > 0) ||
      d.grosObjetsAutre?.trim() ||
      d.petitsObjetsAutre?.trim() ||
      // compat anciennes demandes
      d.largeItems?.trim() ||
      d.furniture?.trim() ||
      d.smallItems?.trim(),
  );
  const ca = d.collectAddress;
  const hasCollectAddress = Boolean(
    ca?.address?.trim() && ca?.postalCode?.trim() && ca?.city?.trim(),
  );
  return (
    customerComplete(customer) &&
    Boolean(customer.address?.trim()) &&
    Boolean(customer.postalCode?.trim()) &&
    Boolean(customer.city?.trim()) &&
    hasCollectAddress &&
    hasItems
  );
}

export function isArticleComplete(customer: CustomerInput): boolean {
  return customerComplete(customer);
}

type VeloInput = {
  bikeType?: string;
  service?: string;
  brand?: string;
  condition?: string;
  description?: string;
};

export function isVeloComplete(customer: CustomerInput, d: VeloInput): boolean {
  return (
    customerComplete(customer) &&
    Boolean(d.bikeType?.trim()) &&
    Boolean(d.service?.trim())
  );
}

type LivraisonInput = {
  deliveryAddress?: {
    address?: string;
    postalCode?: string;
    city?: string;
  };
  articlePhoto?: string;
};

export function isLivraisonComplete(
  customer: CustomerInput,
  d: LivraisonInput,
): boolean {
  const da = d.deliveryAddress;
  const hasDeliveryAddress = Boolean(
    da?.address?.trim() && da?.postalCode?.trim() && da?.city?.trim(),
  );
  return (
    customerComplete(customer) && hasDeliveryAddress && Boolean(d.articlePhoto)
  );
}
