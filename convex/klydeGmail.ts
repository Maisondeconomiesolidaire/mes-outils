/**
 * Klyd — lecture de la boîte Gmail Vinted.
 *
 * Vinted n'expose aucune API publique : tout ce qui compte pour le suivi des
 * ventes (article vendu, bordereau d'expédition, numéro de suivi, virement)
 * n'arrive que par email. Ce module connecte une boîte Gmail en OAuth Google
 * (scope `gmail.readonly` — lecture seule, jamais d'envoi ni de suppression),
 * importe les emails Vinted, en extrait les informations utiles et les
 * rapproche des articles du stock Klyd.
 *
 * Variables d'environnement du déploiement Convex (`npx convex env set … --prod`) :
 *   GOOGLE_CLIENT_ID       — identifiant OAuth « Application Web » Google Cloud
 *   GOOGLE_CLIENT_SECRET   — secret associé
 *   KLYDE_APP_URL          — URL publique de Klyd (retour après consentement)
 *
 * URI de redirection à déclarer côté Google Cloud (exactement) :
 *   https://hip-marten-394.eu-west-1.convex.site/klyde/gmail/oauth/callback
 */
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";

/** Clé de permission CRM de la boîte Vinted (administrée depuis Mes Outils). */
const PAGE_KEY = "klyde:vinted";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Scopes demandés. `gmail.readonly` est volontairement le seul accès Gmail :
 * l'app ne doit jamais pouvoir écrire, envoyer ou supprimer dans la boîte.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
].join(" ");

/** Requête Gmail par défaut : tout ce qui vient de Vinted. */
const DEFAULT_QUERY = "from:(vinted.fr OR vinted.com OR vinted.co.uk)";

/** Nombre maximal de messages traités par exécution (limites d'action Convex). */
const MAX_MESSAGES_PER_SYNC = 60;

/** Un état OAuth non consommé expire au bout de 15 minutes. */
const STATE_TTL_MS = 15 * 60 * 1000;

/* ────────────────────────── Utilitaires bas niveau ─────────────────────── */

function siteUrl() {
  return (
    process.env.CONVEX_SITE_URL ?? "https://hip-marten-394.eu-west-1.convex.site"
  ).replace(/\/$/, "");
}

function redirectUri() {
  return `${siteUrl()}/klyde/gmail/oauth/callback`;
}

function klydeAppUrl() {
  return (process.env.KLYDE_APP_URL ?? "https://klyd.groupemes.fr").replace(/\/$/, "");
}

function googleCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants sur le déploiement Convex.",
    );
  }
  return { clientId, clientSecret };
}

/** Gmail encode les corps en base64url (`-` et `_`, sans padding). */
function decodeBase64Url(data: string): Uint8Array {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeBase64UrlToText(data: string): string {
  try {
    return new TextDecoder("utf-8").decode(decodeBase64Url(data));
  } catch {
    return "";
  }
}

/**
 * Aplatit un corps HTML en texte lisible : les emails Vinted n'ont pas toujours
 * de partie `text/plain`, et une extraction sur du HTML brut casse les regex.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&euro;/gi, "€")
    .replace(/[ \t\u00a0\u202f]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart;
};

function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return found?.value ?? "";
}

/** Parcourt récursivement l'arbre MIME et renvoie toutes les feuilles. */
function flattenParts(part: GmailPart | undefined): GmailPart[] {
  if (!part) return [];
  if (!part.parts?.length) return [part];
  return part.parts.flatMap((child) => flattenParts(child));
}

/** Corps du message en texte : `text/plain` en priorité, sinon HTML aplati. */
export function messageBodyText(message: GmailMessage): string {
  const parts = flattenParts(message.payload);
  const plain = parts
    .filter((p) => p.mimeType === "text/plain" && p.body?.data)
    .map((p) => decodeBase64UrlToText(p.body!.data!))
    .join("\n")
    .trim();
  if (plain) return plain.slice(0, 20000);
  const html = parts
    .filter((p) => p.mimeType === "text/html" && p.body?.data)
    .map((p) => decodeBase64UrlToText(p.body!.data!))
    .join("\n");
  return htmlToText(html).slice(0, 20000);
}

/** Concatène texte et HTML : les liens (bordereau) ne vivent que dans le HTML. */
function messageRawHtml(message: GmailMessage): string {
  return flattenParts(message.payload)
    .filter((p) => p.mimeType === "text/html" && p.body?.data)
    .map((p) => decodeBase64UrlToText(p.body!.data!))
    .join("\n");
}

/* ─────────────────────────── Analyse des emails ────────────────────────── */

export type VintedKind =
  | "vente"
  | "bordereau"
  | "expedition"
  | "paiement"
  | "offre"
  | "message"
  | "autre";

/**
 * Nature du message, déduite du sujet puis du corps. L'ordre des tests compte :
 * un email de vente contient souvent aussi le mot « bordereau », mais c'est
 * bien la vente qui est l'événement à retenir.
 */
export function classifyEmail(subject: string, body: string): VintedKind {
  const text = `${subject}\n${body}`.toLowerCase();
  const has = (...needles: string[]) => needles.some((n) => text.includes(n));

  if (has("est vendu", "a été vendu", "vendu !", "bonne nouvelle", "tu as vendu", "article vendu"))
    return "vente";
  if (has("bordereau", "étiquette d'expédition", "etiquette d'expedition", "imprime ton", "imprimer l'étiquette"))
    return "bordereau";
  if (has("colis", "numéro de suivi", "numero de suivi", "expédi", "expedi", "livraison", "point relais"))
    return "expedition";
  if (has("virement", "paiement", "porte-monnaie", "solde", "tu as reçu", "transfert d'argent"))
    return "paiement";
  if (has("offre", "propose", "négoci", "negoci")) return "offre";
  if (has("message", "t'a écrit", "nouvelle discussion")) return "message";
  return "autre";
}

/** Montant en euros : « 12,50 € », « € 12.50 », « 12 € ». Prend le plus élevé. */
export function extractAmount(text: string): number | undefined {
  const matches = [
    ...text.matchAll(/(?:€\s*)?(\d{1,4}(?:[\s\u202f\u00a0]?\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euros?\b)/gi),
  ];
  const values = matches
    .map((m) => Number(m[1].replace(/[\s\u202f\u00a0]/g, "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);
  if (!values.length) return undefined;
  return Math.max(...values);
}

/** Numéro de commande Vinted (« Commande n° 1234567890 », « #1234567 »). */
export function extractOrderRef(text: string): string | undefined {
  const labelled = text.match(
    /(?:commande|transaction|vente)\s*(?:n[°ºo]\s*|num[ée]ro\s*:?\s*|#)\s*([A-Z0-9-]{5,25})/i,
  );
  if (labelled) return labelled[1];
  const hash = text.match(/#\s?(\d{6,15})\b/);
  return hash?.[1];
}

const CARRIERS = [
  "Mondial Relay",
  "Colissimo",
  "Chronopost",
  "Relais Colis",
  "Shop2Shop",
  "UPS",
  "DHL",
  "DPD",
  "GLS",
  "La Poste",
  "InPost",
  "Vinted Go",
];

export function extractCarrier(text: string): string | undefined {
  const lower = text.toLowerCase();
  return CARRIERS.find((carrier) => lower.includes(carrier.toLowerCase()));
}

/**
 * Numéro de suivi : d'abord une mention explicite, sinon un identifiant au
 * format transporteur. On évite délibérément les suites de chiffres nues, qui
 * attrapent surtout des montants et des numéros de commande.
 */
export function extractTrackingNumber(text: string): string | undefined {
  const labelled = text.match(
    /(?:num[ée]ro de suivi|n[°ºo] de suivi|suivi|tracking(?: number)?)\s*:?\s*([A-Z0-9]{8,25})/i,
  );
  if (labelled) return labelled[1].toUpperCase();
  const postal = text.match(/\b([A-Z]{2}\d{9}[A-Z]{2})\b/);
  if (postal) return postal[1];
  const mondialRelay = text.match(/\b(\d{8}|\d{11,13})\b(?=[^\n]{0,40}(?:mondial relay|relais|colis))/i);
  return mondialRelay?.[1];
}

/** Lien de téléchargement/impression du bordereau, cherché dans le HTML. */
export function extractLabelUrl(html: string, text: string): string | undefined {
  const hrefs = [...html.matchAll(/href="([^"]+)"/gi)].map((m) => m[1]);
  const inline = [...text.matchAll(/https?:\/\/[^\s<>")]+/gi)].map((m) => m[0]);
  const candidates = [...hrefs, ...inline];
  const scored = candidates.find((url) =>
    /label|shipping|bordereau|etiquette|étiquette|\.pdf/i.test(url),
  );
  return scored?.replace(/&amp;/g, "&").slice(0, 1500);
}

/**
 * Titre de l'article. Vinted le met sur une ligne isolée après une accroche du
 * type « Ton article … a été vendu » ; à défaut on prend le sujet nettoyé.
 */
export function extractItemTitle(subject: string, body: string): string | undefined {
  const quoted = body.match(/[«"“]\s*([^»"”\n]{3,80})\s*[»"”]/);
  if (quoted) return quoted[1].trim();
  const afterLabel = body.match(
    /(?:article|annonce|objet)\s*:?\s*\n?\s*([^\n]{3,80})/i,
  );
  if (afterLabel) {
    const value = afterLabel[1].trim();
    if (value && !/^https?:/i.test(value)) return value;
  }
  const fromSubject = subject
    .replace(/^(re|fwd)\s*:\s*/i, "")
    .replace(/vinted/gi, "")
    .replace(/[!🎉✅📦💶💰]/gu, "")
    .trim();
  return fromSubject.length >= 3 ? fromSubject.slice(0, 80) : undefined;
}

/** Pseudo de l'acheteur (« @pseudo », « acheté par pseudo »). */
export function extractBuyer(text: string): string | undefined {
  const labelled = text.match(
    /(?:acheteur|achet[ée] par|vendu [àa]|de la part de)\s*:?\s*@?([A-Za-z0-9._-]{3,30})/i,
  );
  if (labelled) return labelled[1];
  const at = text.match(/(?:^|\s)@([A-Za-z0-9._-]{3,30})\b/);
  return at?.[1];
}

export type ParsedEmail = {
  kind: VintedKind;
  itemTitle?: string;
  amount?: number;
  buyer?: string;
  orderRef?: string;
  trackingNumber?: string;
  carrier?: string;
  labelUrl?: string;
};

/** Extraction complète, purement locale (aucun appel réseau). */
export function parseVintedEmail(subject: string, body: string, html: string): ParsedEmail {
  const kind = classifyEmail(subject, body);
  const haystack = `${subject}\n${body}`;
  return {
    kind,
    itemTitle: extractItemTitle(subject, body),
    amount: extractAmount(haystack),
    buyer: extractBuyer(haystack),
    orderRef: extractOrderRef(haystack),
    trackingNumber: extractTrackingNumber(haystack),
    carrier: extractCarrier(haystack),
    labelUrl: kind === "bordereau" || kind === "expedition" ? extractLabelUrl(html, body) : undefined,
  };
}

/* ───────────────────────────── Accès Google ───────────────────────────── */

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await response.json()) as TokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(
      `Échange du code Google refusé : ${data.error_description ?? data.error ?? response.status}`,
    );
  }
  return data;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = (await response.json()) as TokenResponse;
  if (!response.ok || !data.access_token) {
    throw new Error(
      `Rafraîchissement du jeton Google refusé : ${data.error_description ?? data.error ?? response.status}`,
    );
  }
  return data;
}

/**
 * Jeton d'accès valide pour un compte : réutilise celui en base tant qu'il
 * reste plus d'une minute de validité, sinon le rafraîchit et le persiste.
 */
async function accessTokenFor(
  ctx: ActionCtx,
  account: Doc<"klydeGmailAccounts">,
): Promise<string> {
  if (
    account.accessToken &&
    account.accessTokenExpiresAt &&
    account.accessTokenExpiresAt - Date.now() > 60_000
  ) {
    return account.accessToken;
  }
  const refreshed = await refreshAccessToken(account.refreshToken);
  const expiresAt = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
  await ctx.runMutation(internal.klydeGmail.storeAccessToken, {
    accountId: account._id,
    accessToken: refreshed.access_token!,
    accessTokenExpiresAt: expiresAt,
  });
  return refreshed.access_token!;
}

async function gmailGet<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Gmail ${path} → ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/* ──────────────────────── Étape 1 : consentement ───────────────────────── */

/**
 * Prépare la redirection vers Google. On enregistre un `state` aléatoire lié à
 * l'utilisateur connecté : au retour, un `code` présenté sans état connu est
 * rejeté (protection CSRF).
 */
export const connectUrl = action({
  args: { returnUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<string> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Connexion requise.");
    await ctx.runQuery(internal.klydeGmail.assertCanManage, {});
    const { clientId } = googleCredentials();

    const state = crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internal.klydeGmail.createOAuthState, {
      state,
      clerkId: identity.subject,
      clerkName: identity.name,
      returnUrl: args.returnUrl ?? `${klydeAppUrl()}/`,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES,
      // `offline` + `consent` : indispensables pour obtenir (et ré-obtenir) le
      // refresh token, sans lequel la synchronisation s'arrête au bout d'une heure.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  },
});

export const assertCanManage = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    return true;
  },
});

export const createOAuthState = internalMutation({
  args: {
    state: v.string(),
    clerkId: v.string(),
    clerkName: v.optional(v.string()),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    // Ménage opportuniste : les états non consommés n'ont plus d'intérêt.
    const stale = await ctx.db.query("klydeGmailOAuthStates").collect();
    for (const entry of stale) {
      if (Date.now() - entry.createdAt > STATE_TTL_MS) await ctx.db.delete(entry._id);
    }
    await ctx.db.insert("klydeGmailOAuthStates", { ...args, createdAt: Date.now() });
  },
});

export const consumeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("klydeGmailOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!entry) return null;
    await ctx.db.delete(entry._id);
    if (Date.now() - entry.createdAt > STATE_TTL_MS) return null;
    return { clerkId: entry.clerkId, clerkName: entry.clerkName, returnUrl: entry.returnUrl };
  },
});

/* ──────────────── Étape 2 : retour de Google (HTTP action) ─────────────── */

/**
 * Appelée par la route HTTP `/klyde/gmail/oauth/callback`. Renvoie l'URL de
 * redirection finale (avec `?gmail=ok` ou `?gmail=error&message=…`) pour que
 * l'utilisateur retombe dans Klyd avec un message clair.
 */
export const completeOAuth = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<string> => {
    const pending = await ctx.runMutation(internal.klydeGmail.consumeOAuthState, {
      state: args.state,
    });
    if (!pending) {
      return `${klydeAppUrl()}/?gmail=error&message=${encodeURIComponent(
        "Demande de connexion expirée ou inconnue. Relance la connexion depuis Klyd.",
      )}`;
    }

    try {
      const tokens = await exchangeCode(args.code);
      const profile = (await (
        await fetch(GOOGLE_USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })
      ).json()) as { email?: string };
      const email = profile.email;
      if (!email) throw new Error("Google n'a pas renvoyé l'adresse du compte.");
      if (!tokens.refresh_token) {
        throw new Error(
          "Google n'a pas renvoyé de refresh token. Retire l'accès de l'app dans myaccount.google.com/permissions puis recommence.",
        );
      }

      const accountId: Id<"klydeGmailAccounts"> = await ctx.runMutation(
        internal.klydeGmail.upsertAccount,
        {
          email,
          connectedByClerkId: pending.clerkId,
          connectedByName: pending.clerkName,
          refreshToken: tokens.refresh_token,
          accessToken: tokens.access_token,
          accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        },
      );

      // Première synchronisation immédiate : la boîte est utile tout de suite.
      await ctx.scheduler.runAfter(0, internal.klydeGmail.syncAccount, { accountId });
      return `${pending.returnUrl}${pending.returnUrl.includes("?") ? "&" : "?"}gmail=ok&email=${encodeURIComponent(email)}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `${pending.returnUrl}${pending.returnUrl.includes("?") ? "&" : "?"}gmail=error&message=${encodeURIComponent(message)}`;
    }
  },
});

export const upsertAccount = internalMutation({
  args: {
    email: v.string(),
    connectedByClerkId: v.string(),
    connectedByName: v.optional(v.string()),
    refreshToken: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"klydeGmailAccounts">> => {
    const existing = await ctx.db
      .query("klydeGmailAccounts")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        connectedByClerkId: args.connectedByClerkId,
        connectedByName: args.connectedByName,
        refreshToken: args.refreshToken,
        accessToken: args.accessToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        active: true,
        lastSyncError: undefined,
        updatedAt: now,
      });
      return existing._id;
    }
    return ctx.db.insert("klydeGmailAccounts", {
      ...args,
      query: DEFAULT_QUERY,
      active: true,
      importedCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const storeAccessToken = internalMutation({
  args: {
    accountId: v.id("klydeGmailAccounts"),
    accessToken: v.string(),
    accessTokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, {
      accessToken: args.accessToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
      updatedAt: Date.now(),
    });
  },
});

/* ───────────────────────── Étape 3 : synchronisation ───────────────────── */

export const getAccount = internalQuery({
  args: { accountId: v.id("klydeGmailAccounts") },
  handler: async (ctx, args) => ctx.db.get(args.accountId),
});

export const activeAccountIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.db
      .query("klydeGmailAccounts")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return accounts.map((account) => account._id);
  },
});

export const knownGmailIds = internalQuery({
  args: { gmailIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const known: string[] = [];
    for (const gmailId of args.gmailIds) {
      const existing = await ctx.db
        .query("klydeVintedEmails")
        .withIndex("by_gmailId", (q) => q.eq("gmailId", gmailId))
        .unique();
      if (existing) known.push(gmailId);
    }
    return known;
  },
});

/**
 * Rapprochement email → article : d'abord la référence (SKU) citée dans le
 * corps, sinon le meilleur recouvrement de mots avec le titre de l'article.
 * Volontairement conservateur : un mauvais rattachement fausse le CA.
 */
function matchScore(itemTitle: string, emailTitle: string): number {
  const words = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2);
  const a = new Set(words(itemTitle));
  const b = words(emailTitle);
  if (!a.size || !b.length) return 0;
  const hits = b.filter((word) => a.has(word)).length;
  return hits / Math.max(a.size, b.length);
}

export const saveEmail = internalMutation({
  args: {
    accountId: v.id("klydeGmailAccounts"),
    gmailId: v.string(),
    threadId: v.optional(v.string()),
    sentAt: v.number(),
    subject: v.string(),
    from: v.string(),
    snippet: v.optional(v.string()),
    bodyText: v.optional(v.string()),
    kind: v.union(
      v.literal("vente"),
      v.literal("bordereau"),
      v.literal("expedition"),
      v.literal("paiement"),
      v.literal("offre"),
      v.literal("message"),
      v.literal("autre"),
    ),
    itemTitle: v.optional(v.string()),
    amount: v.optional(v.number()),
    buyer: v.optional(v.string()),
    orderRef: v.optional(v.string()),
    trackingNumber: v.optional(v.string()),
    carrier: v.optional(v.string()),
    labelUrl: v.optional(v.string()),
    attachments: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          filename: v.string(),
          mimeType: v.string(),
          size: v.optional(v.number()),
        }),
      ),
    ),
    aiParsed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("klydeVintedEmails")
      .withIndex("by_gmailId", (q) => q.eq("gmailId", args.gmailId))
      .unique();
    if (existing) return { created: false as const, id: existing._id };

    // Rapprochement automatique avec un article du stock.
    let matchedItemId: Id<"klydeItems"> | undefined;
    let matchConfidence: number | undefined;
    const haystack = `${args.subject}\n${args.bodyText ?? ""}`;
    const items = await ctx.db.query("klydeItems").order("desc").take(600);
    const bySku = items.find(
      (item) => item.sku && haystack.toLowerCase().includes(item.sku.toLowerCase()),
    );
    if (bySku) {
      matchedItemId = bySku._id;
      matchConfidence = 1;
    } else if (args.itemTitle) {
      let best: { id: Id<"klydeItems">; score: number } | null = null;
      for (const item of items) {
        const score = matchScore(item.title, args.itemTitle);
        if (!best || score > best.score) best = { id: item._id, score };
      }
      if (best && best.score >= 0.5) {
        matchedItemId = best.id;
        matchConfidence = Number(best.score.toFixed(2));
      }
    }

    const id = await ctx.db.insert("klydeVintedEmails", {
      ...args,
      matchedItemId,
      matchConfidence,
      handled: false,
      createdAt: Date.now(),
    });
    return { created: true as const, id };
  },
});

export const finishSync = internalMutation({
  args: {
    accountId: v.id("klydeGmailAccounts"),
    lastMessageDate: v.optional(v.number()),
    imported: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) return;
    await ctx.db.patch(args.accountId, {
      lastSyncAt: Date.now(),
      lastSyncError: args.error,
      lastMessageDate: Math.max(args.lastMessageDate ?? 0, account.lastMessageDate ?? 0) || undefined,
      importedCount: (account.importedCount ?? 0) + args.imported,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Importe les emails Vinted d'un compte. Incrémental : on repart de la date du
 * dernier message déjà importé (moins un jour de marge, Gmail filtrant par
 * jour), et on ignore les identifiants déjà connus.
 */
export const syncAccount = internalAction({
  args: {
    accountId: v.id("klydeGmailAccounts"),
    /** Ignore la borne incrémentale (première importation, rattrapage). */
    full: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ imported: number; scanned: number }> => {
    const account: Doc<"klydeGmailAccounts"> | null = await ctx.runQuery(
      internal.klydeGmail.getAccount,
      { accountId: args.accountId },
    );
    if (!account || !account.active) return { imported: 0, scanned: 0 };

    let imported = 0;
    let scanned = 0;
    let newestDate = account.lastMessageDate ?? 0;
    try {
      const token = await accessTokenFor(ctx, account);
      const queryParts = [account.query ?? DEFAULT_QUERY];
      if (!args.full && account.lastMessageDate) {
        const afterSeconds = Math.floor((account.lastMessageDate - 24 * 3600 * 1000) / 1000);
        queryParts.push(`after:${afterSeconds}`);
      }
      const listing = await gmailGet<{ messages?: Array<{ id: string }> }>(
        token,
        `/messages?maxResults=${MAX_MESSAGES_PER_SYNC}&q=${encodeURIComponent(queryParts.join(" "))}`,
      );
      const ids = (listing.messages ?? []).map((m) => m.id);
      const known = new Set<string>(
        await ctx.runQuery(internal.klydeGmail.knownGmailIds, { gmailIds: ids }),
      );

      for (const gmailId of ids) {
        if (known.has(gmailId)) continue;
        scanned += 1;
        const message = await gmailGet<GmailMessage>(token, `/messages/${gmailId}?format=full`);
        const sentAt = Number(message.internalDate ?? Date.now());
        const subject = header(message, "Subject");
        const from = header(message, "From");
        const body = messageBodyText(message);
        const html = messageRawHtml(message);
        const parsed = parseVintedEmail(subject, body, html);

        // Pièces jointes (bordereaux PDF) rapatriées dans le stockage Convex :
        // elles restent consultables même si le lien Vinted expire.
        const attachments: Array<{
          storageId: Id<"_storage">;
          filename: string;
          mimeType: string;
          size?: number;
        }> = [];
        for (const part of flattenParts(message.payload)) {
          if (!part.filename || !part.body?.attachmentId) continue;
          if (!/pdf|image\//i.test(part.mimeType ?? "")) continue;
          if ((part.body.size ?? 0) > 8 * 1024 * 1024) continue;
          const attachment = await gmailGet<{ data?: string; size?: number }>(
            token,
            `/messages/${gmailId}/attachments/${part.body.attachmentId}`,
          );
          if (!attachment.data) continue;
          const bytes = decodeBase64Url(attachment.data);
          const storageId = await ctx.storage.store(
            new Blob([bytes as unknown as BlobPart], {
              type: part.mimeType ?? "application/octet-stream",
            }),
          );
          attachments.push({
            storageId,
            filename: part.filename,
            mimeType: part.mimeType ?? "application/octet-stream",
            size: attachment.size ?? part.body.size,
          });
        }

        const result = await ctx.runMutation(internal.klydeGmail.saveEmail, {
          accountId: account._id,
          gmailId,
          threadId: message.threadId,
          sentAt,
          subject,
          from,
          snippet: message.snippet?.slice(0, 500),
          bodyText: body || undefined,
          ...parsed,
          attachments: attachments.length ? attachments : undefined,
        });
        if (result.created) imported += 1;
        if (sentAt > newestDate) newestDate = sentAt;
      }

      await ctx.runMutation(internal.klydeGmail.finishSync, {
        accountId: account._id,
        lastMessageDate: newestDate || undefined,
        imported,
      });
      return { imported, scanned };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.klydeGmail.finishSync, {
        accountId: account._id,
        lastMessageDate: newestDate || undefined,
        imported,
        error: message.slice(0, 500),
      });
      throw error;
    }
  },
});

/** Cron : passe sur toutes les boîtes connectées. */
export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids: Id<"klydeGmailAccounts">[] = await ctx.runQuery(
      internal.klydeGmail.activeAccountIds,
      {},
    );
    for (const accountId of ids) {
      try {
        await ctx.runAction(internal.klydeGmail.syncAccount, { accountId });
      } catch (error) {
        // Une boîte en échec (consentement révoqué) ne doit pas bloquer les autres.
        console.error(
          `Sync Gmail Vinted ${accountId} : ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  },
});

/** Synchronisation déclenchée depuis Klyd. */
export const syncNow = action({
  args: {
    accountId: v.optional(v.id("klydeGmailAccounts")),
    full: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ imported: number; scanned: number }> => {
    await ctx.runQuery(internal.klydeGmail.assertCanUpdate, {});
    const ids: Id<"klydeGmailAccounts">[] = args.accountId
      ? [args.accountId]
      : await ctx.runQuery(internal.klydeGmail.activeAccountIds, {});
    let imported = 0;
    let scanned = 0;
    for (const accountId of ids) {
      const result = await ctx.runAction(internal.klydeGmail.syncAccount, {
        accountId,
        full: args.full,
      });
      imported += result.imported;
      scanned += result.scanned;
    }
    return { imported, scanned };
  },
});

export const assertCanUpdate = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    return true;
  },
});

/* ────────────────────────── Lecture depuis Klyd ────────────────────────── */

export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const accounts = await ctx.db.query("klydeGmailAccounts").collect();
    // Les jetons ne sortent jamais du backend.
    return accounts.map((account) => ({
      _id: account._id,
      email: account.email,
      active: account.active,
      connectedByName: account.connectedByName,
      query: account.query ?? DEFAULT_QUERY,
      lastSyncAt: account.lastSyncAt,
      lastSyncError: account.lastSyncError,
      lastMessageDate: account.lastMessageDate,
      importedCount: account.importedCount ?? 0,
      createdAt: account.createdAt,
    }));
  },
});

export const listEmails = query({
  args: {
    kind: v.optional(
      v.union(
        v.literal("vente"),
        v.literal("bordereau"),
        v.literal("expedition"),
        v.literal("paiement"),
        v.literal("offre"),
        v.literal("message"),
        v.literal("autre"),
      ),
    ),
    onlyPending: v.optional(v.boolean()),
    searchText: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const limit = Math.min(args.limit ?? 100, 300);
    const rows = args.kind
      ? await ctx.db
          .query("klydeVintedEmails")
          .withIndex("by_kind", (q) => q.eq("kind", args.kind!))
          .order("desc")
          .take(600)
      : await ctx.db.query("klydeVintedEmails").withIndex("by_sentAt").order("desc").take(600);

    const search = args.searchText?.trim().toLowerCase();
    const filtered = rows
      .filter((row) => (args.onlyPending ? !row.handled : true))
      .filter((row) =>
        search
          ? [row.subject, row.itemTitle, row.buyer, row.orderRef, row.trackingNumber, row.snippet]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(search)
          : true,
      )
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, limit);

    return Promise.all(
      filtered.map(async (row) => {
        const item = row.matchedItemId ? await ctx.db.get(row.matchedItemId) : null;
        const attachments = await Promise.all(
          (row.attachments ?? []).map(async (attachment) => ({
            ...attachment,
            url: await ctx.storage.getUrl(attachment.storageId),
          })),
        );
        return {
          ...row,
          // Le corps complet n'est pas utile en liste : il alourdit la souscription.
          bodyText: row.bodyText?.slice(0, 1200),
          attachments,
          matchedItem: item
            ? { _id: item._id, title: item.title, sku: item.sku, status: item.status, price: item.price }
            : null,
        };
      }),
    );
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const rows = await ctx.db.query("klydeVintedEmails").withIndex("by_sentAt").order("desc").take(600);
    const byKind: Record<string, number> = {};
    let pending = 0;
    let revenue = 0;
    for (const row of rows) {
      byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
      if (!row.handled) pending += 1;
      if (row.kind === "vente" && row.amount) revenue += row.amount;
    }
    return { total: rows.length, pending, byKind, revenue };
  },
});

/* ───────────────────────── Actions sur les emails ──────────────────────── */

export const setHandled = mutation({
  args: { emailId: v.id("klydeVintedEmails"), handled: v.boolean() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    const identity = await ctx.auth.getUserIdentity();
    await ctx.db.patch(args.emailId, {
      handled: args.handled,
      handledAt: args.handled ? Date.now() : undefined,
      handledByClerkId: args.handled ? identity?.subject : undefined,
    });
  },
});

export const linkItem = mutation({
  args: {
    emailId: v.id("klydeVintedEmails"),
    itemId: v.optional(v.id("klydeItems")),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    await ctx.db.patch(args.emailId, {
      matchedItemId: args.itemId,
      // Rattachement humain : confiance maximale, il ne sera plus recalculé.
      matchConfidence: args.itemId ? 1 : undefined,
    });
  },
});

/**
 * Applique un email de vente à l'article rattaché : prix réellement encaissé et
 * passage du statut à « gagné ». C'est le geste qui fait gagner du temps —
 * l'information n'est plus ressaisie à la main depuis la boîte mail.
 */
export const applySaleToItem = mutation({
  args: {
    emailId: v.id("klydeVintedEmails"),
    itemId: v.optional(v.id("klydeItems")),
    amount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    await requireCrmPermission(ctx, "klyde:stock", "update");
    const email = await ctx.db.get(args.emailId);
    if (!email) throw new Error("Email introuvable.");
    const itemId = args.itemId ?? email.matchedItemId;
    if (!itemId) throw new Error("Aucun article rattaché à cet email.");
    const item = await ctx.db.get(itemId);
    if (!item) throw new Error("Article introuvable.");

    const amount = args.amount ?? email.amount;
    await ctx.db.patch(itemId, {
      status: "gagne",
      actualSalePrice: amount ?? item.actualSalePrice,
      updatedAt: Date.now(),
    });
    const identity = await ctx.auth.getUserIdentity();
    await ctx.db.patch(args.emailId, {
      matchedItemId: itemId,
      matchConfidence: 1,
      handled: true,
      handledAt: Date.now(),
      handledByClerkId: identity?.subject,
    });
    return { itemId, amount };
  },
});

export const setAccountActive = mutation({
  args: { accountId: v.id("klydeGmailAccounts"), active: v.boolean() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    await ctx.db.patch(args.accountId, { active: args.active, updatedAt: Date.now() });
  },
});

export const setAccountQuery = mutation({
  args: { accountId: v.id("klydeGmailAccounts"), query: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "manage");
    const cleaned = args.query.trim() || DEFAULT_QUERY;
    await ctx.db.patch(args.accountId, { query: cleaned, updatedAt: Date.now() });
  },
});

/**
 * Déconnecte une boîte : les jetons sont effacés côté Convex et l'autorisation
 * est révoquée côté Google. Les emails déjà importés sont conservés (ils font
 * partie de l'historique des ventes).
 */
export const disconnect = action({
  args: { accountId: v.id("klydeGmailAccounts") },
  handler: async (ctx, args) => {
    await ctx.runQuery(internal.klydeGmail.assertCanManage, {});
    const account: Doc<"klydeGmailAccounts"> | null = await ctx.runQuery(
      internal.klydeGmail.getAccount,
      { accountId: args.accountId },
    );
    if (!account) return;
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: account.refreshToken }),
      });
    } catch {
      // Révocation best-effort : la suppression locale prime.
    }
    await ctx.runMutation(internal.klydeGmail.deleteAccount, { accountId: args.accountId });
  },
});

export const deleteAccount = internalMutation({
  args: { accountId: v.id("klydeGmailAccounts") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.accountId);
  },
});
