import { mutation, query } from "./_generated/server";
import { titleCaseName, requireCrmPermission, hasCrmPermission } from "./lib";
import type { Doc } from "./_generated/dataModel";

function currentProcessStep(request: Doc<"requests">) {
  if (!request.processSteps.length) return null;
  if (request.completedSteps <= 0) return "Nouvelle demande";
  return (
    request.processSteps[
      Math.min(request.completedSteps, request.processSteps.length) - 1
    ] ?? null
  );
}

function requestPreview(request: Doc<"requests">) {
  switch (request.type) {
    case "aerogommage": {
      const items = request.aerogommage ?? [];
      if (items.length === 0) {
        return {
          preview: "Demande d'aérogommage à qualifier.",
          secondaryPreview: request.comment ?? undefined,
        };
      }
      if (items.length === 1) {
        const item = items[0];
        const name =
          item.label?.trim() ||
          item.objectType?.trim() ||
          "Objet à aérogommer";
        return {
          preview: name,
          secondaryPreview:
            [item.woodType, item.coating].filter(Boolean).join(" · ") ||
            request.comment ||
            undefined,
        };
      }
      return {
        preview: `${items.length} objets à aérogommer`,
        secondaryPreview: request.comment ?? undefined,
      };
    }
    case "collecte": {
      const address = request.collecte?.collectAddress;
      return {
        preview:
          [address?.postalCode, address?.city].filter(Boolean).join(" ") ||
          "Collecte à domicile",
        secondaryPreview:
          [
            request.collecteType && request.collecteType !== "indefini"
              ? `Collecte ${request.collecteType}`
              : "Collecte à définir",
            request.comment,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      };
    }
    case "article": {
      const count = request.articles?.length ?? (request.article ? 1 : 0);
      const firstTitle =
        request.articles?.[0]?.articleTitle ?? request.article?.articleTitle;
      return {
        preview:
          count > 1
            ? `${count} articles réservés`
            : firstTitle || "Réservation boutique",
        secondaryPreview:
          request.payment?.method === "cb"
            ? request.payment.validated
              ? "Paiement carte validé"
              : "Paiement carte en attente"
            : "Paiement en espèces prévu en boutique",
      };
    }
    case "velo":
      return {
        preview:
          [request.velo?.bikeType, request.velo?.service]
            .filter(Boolean)
            .join(" · ") || "Atelier vélo",
        secondaryPreview:
          request.velo?.brand || request.comment || undefined,
      };
    default:
      return {
        preview: request.comment || "Nouvelle demande",
        secondaryPreview: undefined,
      };
  }
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, "notifications", "read");
    const notifications = await ctx.db
      .query("notifications")
      .withIndex("by_createdAt")
      .order("desc")
      .collect();

    return await Promise.all(
      notifications.map(async (notification) => {
        const request = await ctx.db.get(notification.requestId);
        if (!request) {
        return {
          ...notification,
          customerName: titleCaseName(notification.customerName),
          requestPreview: "Demande introuvable",
          requestSecondaryPreview: undefined,
            requestReference: undefined,
            requestOrigin: undefined,
            requestComplete: undefined,
            requestOutcome: undefined,
            currentStep: undefined,
            scheduledDate: undefined,
            articleCount: undefined,
            paymentMethod: undefined,
            paymentValidated: undefined,
            paymentCaptured: undefined,
          };
        }

        const preview = requestPreview(request);
        return {
          ...notification,
          customerName: titleCaseName(notification.customerName),
          requestPreview: preview.preview,
          requestSecondaryPreview: preview.secondaryPreview,
          requestReference: request.reference,
          requestOrigin: request.requestOrigin,
          requestComplete: request.complete,
          requestOutcome: request.outcome,
          currentStep: currentProcessStep(request),
          scheduledDate: request.scheduledDate,
          articleCount:
            request.type === "article"
              ? request.articles?.length ?? (request.article ? 1 : 0)
              : undefined,
          paymentMethod: request.payment?.method,
          paymentValidated: request.payment?.validated,
          paymentCaptured: request.payment?.captured,
        };
      }),
    );
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    // Badge permanent → 0 sans erreur si pas d'accès notifications.
    if (!(await hasCrmPermission(ctx, "notifications", "read"))) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_read_and_createdAt", (q) => q.eq("read", false))
      .collect();
    return unread.length;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, "notifications", "manage");
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_read_and_createdAt", (q) => q.eq("read", false))
      .collect();

    await Promise.all(
      unread.map((notification) =>
        ctx.db.patch(notification._id, { read: true }),
      ),
    );
  },
});
