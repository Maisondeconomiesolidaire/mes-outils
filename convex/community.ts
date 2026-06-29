import { v } from "convex/values";
import { action, env, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  emailForClerkId,
  hasCrmPermission,
  requireCrmPermission,
  requireStaff,
  requireUser,
} from "./lib";
import { createMesoutilsNotification } from "./mesoutilsNotifications";

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
    start: v.optional(v.number()),
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

/* ─── Assistant IA pour les posts d'événements ───────────────────────────── */

export const assertCanCreateEvent = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    return true;
  },
});

const EVENT_POST_SYSTEM_PROMPT = `Tu es un assistant IA spécialisé dans la rédaction de posts engageants pour un réseau social d'entreprise. Ton objectif est d'aider les collaborateurs à rédiger des publications claires, impactantes et dynamiques en fonction de quelques mots-clés fournis, n'hésite pas à visiter le site www.eco-solidaire.fr pour récupérer plus d'informations. Tu as le droit à un nombre de caractères maximum de 360.
Ton & Style :
Léger et accessible, avec une pointe d'humour bien dosée.
Sérieux dans le fond, fun dans la forme.
Inspirant et humain : on parle d'économie solidaire, d'impact social et d'innovation locale !
Public :
Principalement les collaborateurs (communication interne).
Possibilité d'être partagé en externe sur notre site, donc un ton accessible au grand public.
Structure suggérée :
Accroche : Une phrase punchy ou une question qui capte l'attention.
Message clé : Expliquer l'info de manière concise et engageante.
Call-to-action (optionnel) : Encourager l'interaction (commentaire, partage, participation…).
Exemples de styles attendus :
"Besoin d'un coup de main pour ta pelouse ? Pas de panique, notre équipe de Pays de Bray Emploi a la main verte ! 🌿💪 #SolidaritéEnAction #JardinageSansStress"
"Aujourd'hui, on a sauvé 12 fauteuils roulants de l'oubli ! 🦸‍♂️♻️ Direction la recyclerie pour une seconde vie. #ÉconomieCirculaire #SantéPourTous"
"Chez Les Sens du Bray, on construit du solide... et du sens. 🌱🏗️ Envie de voir nos dernières réalisations ? Spoiler : c'est du bois, du local et du beau ! #ArchitectureDurable #MadeInBray"
Réponds uniquement avec le texte du post, sans guillemets ni préambule.`;

/** Génère un post d'événement à partir de mots-clés (max 360 caractères). */
export const generateEventPost = action({
  args: { keywords: v.string() },
  handler: async (ctx, { keywords }): Promise<string> => {
    await ctx.runQuery(internal.community.assertCanCreateEvent, {});
    const prompt = keywords.trim();
    if (!prompt) throw new Error("Quelques mots-clés sont nécessaires.");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Clé OpenAI absente du déploiement Convex partagé.");
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.8,
        max_tokens: 220,
        messages: [
          { role: "system", content: EVENT_POST_SYSTEM_PROMPT },
          { role: "user", content: `Mots-clés : ${prompt}` },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Erreur OpenAI (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (data.choices?.[0]?.message?.content ?? "")
      .replace(/^["«»\s]+|["«»\s]+$/g, "")
      .trim();
    // Filet de sécurité : on borne à 360 caractères.
    return text.length > 360 ? `${text.slice(0, 359).trimEnd()}…` : text;
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

/**
 * Une personne se déclare intéressée par un bon plan : notifie l'auteur dans
 * l'app et lui envoie un email « (nom) est intéressé·e par votre annonce ».
 */
export const expressDealInterest = mutation({
  args: { dealId: v.id("dealPosts") },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    const deal = await ctx.db.get(args.dealId);
    if (!deal) throw new Error("Bon plan introuvable.");
    // On ne se notifie pas soi-même.
    if (deal.authorClerkId === identity.subject) return;

    const interestedName = displayName(identity);
    await createMesoutilsNotification(ctx, {
      recipientClerkId: deal.authorClerkId,
      kind: "deal_interest",
      title: `${interestedName} est intéressé·e par votre annonce`,
      body: deal.title,
      actorName: interestedName,
      href: `/messagerie?to=${encodeURIComponent(identity.subject)}&name=${encodeURIComponent(interestedName)}`,
    });

    const email = await emailForClerkId(ctx, deal.authorClerkId);
    if (email) {
      await ctx.scheduler.runAfter(0, internal.mesoutilsEmails.sendDealInterestEmail, {
        email,
        authorName: deal.authorName,
        interestedName,
        dealTitle: deal.title,
      });
    }
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
    const messageId = await ctx.db.insert("directMessages", {
      pairKey: pairKey(identity.subject, args.toClerkId),
      fromClerkId: identity.subject,
      fromName: displayName(identity),
      fromImageUrl: pictureUrl(identity),
      toClerkId: args.toClerkId,
      toName: args.toName.trim() || "Utilisateur",
      body,
      createdAt: Date.now(),
    });
    await createMesoutilsNotification(ctx, {
      recipientClerkId: args.toClerkId,
      kind: "new_direct_message",
      title: `Nouveau message de ${displayName(identity)}`,
      body,
      actorName: displayName(identity),
      href: `/messagerie?to=${encodeURIComponent(identity.subject)}&name=${encodeURIComponent(displayName(identity))}`,
    });
    return messageId;
  },
});

export const unreadDirectCount = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireStaff(ctx);
    const messages = await ctx.db
      .query("directMessages")
      .withIndex("by_to", (q) => q.eq("toClerkId", identity.subject))
      .collect();
    return messages.filter((message) => !message.readAt).length;
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
  return await hasCrmPermission(ctx, PAGE_KEY, "manage");
}
