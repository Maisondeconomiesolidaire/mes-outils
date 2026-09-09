/**
 * Publication sur les réseaux sociaux depuis Mes Outils.
 *
 * Facebook n'a pas d'API de programmation à notre charge : on lui envoie le
 * post avec `published=false` et une date, et il le publie lui-même à l'heure
 * dite. Aucun cron de notre côté, donc aucune publication perdue si le
 * déploiement redémarre.
 *
 * Les jetons de Page vivent dans `socialFacebookPages` et ne sortent jamais du
 * backend : le navigateur ne reçoit que l'identifiant et le nom des Pages.
 */
import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCrmPermission, requireUser } from "./lib";

const PAGE_KEY = "mesoutils:actualites";
const GRAPH_VERSION = "v26.0";

/**
 * Facebook n'accepte une programmation qu'entre 10 minutes et 6 mois. On garde
 * une marge de 15 minutes : le temps de la saisie ne doit pas faire basculer la
 * demande sous la limite entre le clic et l'appel.
 */
const MIN_SCHEDULE_MS = 15 * 60 * 1000;
const MAX_SCHEDULE_MS = 180 * 24 * 60 * 60 * 1000;

/** Pages disponibles pour la publication — sans les jetons. */
export const listPages = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "publish");
    const pages = await ctx.db.query("socialFacebookPages").collect();
    return pages
      .filter((page) => page.active)
      .map((page) => ({ pageId: page.pageId, name: page.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

/** Publications déjà émises pour un évènement (Mes Outils ou Recyclerie). */
export const postsForEvent = query({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const posts = args.eventId
      ? await ctx.db
          .query("socialFacebookPosts")
          .withIndex("by_event", (q) => q.eq("eventId", args.eventId))
          .collect()
      : args.recycappEventId
        ? await ctx.db
            .query("socialFacebookPosts")
            .withIndex("by_recycappEvent", (q) =>
              q.eq("recycappEventId", args.recycappEventId),
            )
            .collect()
        : [];
    return posts
      .map((post) => ({
        id: post._id,
        pageName: post.pageName,
        postId: post.postId,
        scheduledFor: post.scheduledFor,
        createdAt: post.createdAt,
        authorName: post.authorName,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/* ─── Données lues par l'action (qui n'a pas accès à la base) ─────────────── */

export const eventPayload = internalQuery({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    pageId: v.string(),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("socialFacebookPages")
      .withIndex("by_pageId", (q) => q.eq("pageId", args.pageId))
      .unique();
    if (!page || !page.active) throw new Error("Page Facebook inconnue ou désactivée.");

    if (args.eventId) {
      const event = await ctx.db.get(args.eventId);
      if (!event) throw new Error("Évènement introuvable.");
      const photoUrl = event.images[0] ? await ctx.storage.getUrl(event.images[0]) : null;
      return {
        page: { pageId: page.pageId, name: page.name, accessToken: page.accessToken },
        event: {
          title: event.title,
          description: event.description,
          location: event.location,
          start: event.start,
          photoUrl,
        },
      };
    }

    if (args.recycappEventId) {
      const event = await ctx.db.get(args.recycappEventId);
      if (!event) throw new Error("Évènement introuvable.");
      const photoUrl = event.attachments[0]
        ? await ctx.storage.getUrl(event.attachments[0])
        : null;
      return {
        page: { pageId: page.pageId, name: page.name, accessToken: page.accessToken },
        event: {
          title: event.title,
          description: [event.animationType, event.activity].filter(Boolean).join(" · ") || undefined,
          location: event.location,
          start: event.startAt,
          // Une pièce jointe n'est pas forcément une image : seule une photo
          // part avec le post, un PDF de programme n'a rien à y faire.
          photoUrl: /\.(jpe?g|png|webp)(\?|$)/i.test(photoUrl ?? "") ? photoUrl : null,
        },
      };
    }

    throw new Error("Aucun évènement fourni.");
  },
});

export const recordPost = internalMutation({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    pageId: v.string(),
    pageName: v.string(),
    postId: v.string(),
    message: v.string(),
    scheduledFor: v.optional(v.number()),
    withPhoto: v.boolean(),
    authorClerkId: v.string(),
    authorName: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("socialFacebookPosts", { ...args, createdAt: Date.now() });
  },
});

export const assertCanPublish = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "publish");
    const identity = await requireUser(ctx);
    return {
      clerkId: identity.subject,
      name: (identity.name as string | undefined) ?? "Mes Outils",
    };
  },
});

/* ─── Publication ─────────────────────────────────────────────────────────── */

/** Texte du post : titre, date, lieu, puis description. */
function buildMessage(event: {
  title: string;
  description?: string;
  location?: string;
  start?: number;
}) {
  const lines = [event.title];
  if (event.start) {
    lines.push(
      new Date(event.start).toLocaleString("fr-FR", {
        timeZone: "Europe/Paris",
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
  }
  if (event.location) lines.push(`📍 ${event.location}`);
  if (event.description) lines.push("", event.description);
  return lines.join("\n");
}

export const publishEvent = action({
  args: {
    eventId: v.optional(v.id("events")),
    recycappEventId: v.optional(v.id("recycappCalendarEvents")),
    pageId: v.string(),
    /** Absent = publication immédiate ; sinon date de publication (ms). */
    scheduledFor: v.optional(v.number()),
    /** Texte du post, composé depuis l'évènement à défaut. */
    message: v.optional(v.string()),
    /** Photos du post. À défaut, celles de l'évènement. */
    photoStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  handler: async (ctx, args): Promise<{ postId: string; scheduledFor?: number }> => {
    const author: { clerkId: string; name: string } = await ctx.runQuery(
      internal.social.assertCanPublish,
      {},
    );

    if (args.scheduledFor !== undefined) {
      const delay = args.scheduledFor - Date.now();
      if (delay < MIN_SCHEDULE_MS) {
        throw new Error(
          "Facebook exige au moins 10 minutes d'avance : choisissez une date un peu plus tard.",
        );
      }
      if (delay > MAX_SCHEDULE_MS) {
        throw new Error("Facebook ne programme pas au-delà de 6 mois.");
      }
    }

    const payload = await ctx.runQuery(internal.social.eventPayload, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
      pageId: args.pageId,
    });

    const message = args.message?.trim() || buildMessage(payload.event);

    // Photos choisies dans le formulaire ; à défaut, celle de l'évènement.
    const photoUrls: string[] = args.photoStorageIds?.length
      ? (
          await Promise.all(
            args.photoStorageIds.map((id) => ctx.storage.getUrl(id as Id<"_storage">)),
          )
        ).filter((url): url is string => Boolean(url))
      : payload.event.photoUrl
        ? [payload.event.photoUrl]
        : [];

    const graph = (path: string, params: URLSearchParams) =>
      fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
        method: "POST",
        body: params,
      });

    const fail = (result: { error?: { message?: string; code?: number } }, status: number) => {
      const detail = result.error?.message ?? `HTTP ${status}`;
      // Le jeton de Page ne se périme pas, mais il saute si le mot de passe du
      // compte change : le dire évite de chercher ailleurs.
      const hint =
        result.error?.code === 190
          ? " Le jeton de la Page n'est plus valide : reconnectez la Page."
          : "";
      return new Error(`Facebook a refusé la publication : ${detail}.${hint}`);
    };

    /**
     * Les photos sont d'abord déposées sans être publiées, puis rattachées au
     * post : c'est le seul montage qui accepte plusieurs images ET une date de
     * publication. Un envoi direct sur `/photos` ne porterait qu'une image.
     */
    const mediaIds: string[] = [];
    for (const url of photoUrls) {
      const params = new URLSearchParams({
        access_token: payload.page.accessToken,
        url,
        published: "false",
      });
      const response = await graph(`${payload.page.pageId}/photos`, params);
      const result = (await response.json()) as {
        id?: string;
        error?: { message?: string; code?: number };
      };
      if (!response.ok || result.error || !result.id) throw fail(result, response.status);
      mediaIds.push(result.id);
    }

    const body = new URLSearchParams({
      access_token: payload.page.accessToken,
      message,
    });
    mediaIds.forEach((id, index) => {
      body.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }));
    });
    if (args.scheduledFor !== undefined) {
      body.set("published", "false");
      body.set("scheduled_publish_time", String(Math.floor(args.scheduledFor / 1000)));
    }

    const response = await graph(`${payload.page.pageId}/feed`, body);
    const result = (await response.json()) as {
      id?: string;
      post_id?: string;
      error?: { message?: string; code?: number };
    };
    if (!response.ok || result.error) throw fail(result, response.status);

    const postId = result.post_id ?? result.id;
    if (!postId) throw new Error("Facebook n'a pas renvoyé d'identifiant de publication.");

    await ctx.runMutation(internal.social.recordPost, {
      eventId: args.eventId,
      recycappEventId: args.recycappEventId,
      pageId: payload.page.pageId,
      pageName: payload.page.name,
      postId,
      message,
      scheduledFor: args.scheduledFor,
      withPhoto: photoUrls.length > 0,
      authorClerkId: author.clerkId,
      authorName: author.name,
    });

    return { postId, scheduledFor: args.scheduledFor };
  },
});

/**
 * Enregistre (ou met à jour) une Page et son jeton.
 *
 * Interne : les jetons sont posés depuis la ligne de commande, comme les
 * variables d'environnement, et n'ont pas à transiter par une page web.
 */
export const upsertPage = internalMutation({
  args: {
    pageId: v.string(),
    name: v.string(),
    accessToken: v.string(),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("socialFacebookPages")
      .withIndex("by_pageId", (q) => q.eq("pageId", args.pageId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        accessToken: args.accessToken,
        active: args.active ?? true,
        updatedAt: Date.now(),
      });
      return existing._id;
    }
    return await ctx.db.insert("socialFacebookPages", {
      pageId: args.pageId,
      name: args.name,
      accessToken: args.accessToken,
      active: args.active ?? true,
      createdAt: Date.now(),
    });
  },
});
