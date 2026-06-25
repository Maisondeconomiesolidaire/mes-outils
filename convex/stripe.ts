import { v } from "convex/values";
import { action, env } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { accessAllows } from "./lib";
import type { Id } from "./_generated/dataModel";

function buildStripeBody(params: Record<string, string>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.append(key, value);
  }
  return body;
}

function buildCheckoutReturnUrl(
  baseUrl: string,
  params: Record<string, string>,
  includeSessionId = false,
) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let result = url.toString();
  if (includeSessionId) {
    const separator = result.includes("?") ? "&" : "?";
    result += `${separator}session_id={CHECKOUT_SESSION_ID}`;
  }
  return result;
}

export const startTestCheckout = action({
  args: {
    items: v.array(
      v.object({
        articleId: v.id("articles"),
        title: v.string(),
        price: v.number(),
      }),
    ),
    discountAmount: v.optional(v.number()),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, "caisse", "checkout")) {
      throw new Error("Accès CRM insuffisant.");
    }
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY n'est pas configurée côté Convex. Ajoutez votre clé Stripe test avant d'encaisser par carte.",
      );
    }

    const draftId: Id<"stripeCheckoutDrafts"> = await ctx.runMutation(
      internal.ventes.createStripeCheckoutDraft,
      {
        items: args.items,
        discountAmount: args.discountAmount,
        createdBy: access.email ?? "caisse",
      },
    );

    const subtotal = args.items.reduce((sum, item) => sum + item.price, 0);
    const total = Math.max(0, subtotal - (args.discountAmount ?? 0));
    if (total <= 0) {
      throw new Error(
        "Le montant doit être supérieur à 0 € pour un paiement Stripe test.",
      );
    }
    const successUrl = buildCheckoutReturnUrl(
      args.returnUrl,
      {
        stripe_status: "success",
        draft_id: draftId,
      },
      true,
    );

    const cancelUrl = buildCheckoutReturnUrl(args.returnUrl, {
      stripe_status: "cancelled",
      draft_id: draftId,
    });

    const itemSummary = args.items
      .map((item) => item.title.trim())
      .slice(0, 3)
      .join(", ");
    const description =
      args.items.length > 3
        ? `${itemSummary}...`
        : itemSummary || "Paiement boutique";

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildStripeBody({
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        "payment_method_types[0]": "card",
        locale: "fr",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(total * 100)),
        "line_items[0][price_data][product_data][name]": "Paiement boutique GDR",
        "line_items[0][price_data][product_data][description]": description,
        "metadata[draftId]": draftId,
      }),
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      id?: string;
      url?: string;
    };

    if (!response.ok || !payload.id || !payload.url) {
      throw new Error(
        payload.error?.message ||
          "Stripe n'a pas pu créer la session de paiement test.",
      );
    }

    await ctx.runMutation(internal.ventes.attachStripeSessionToDraft, {
      draftId,
      stripeSessionId: payload.id,
    });

    return { checkoutUrl: payload.url };
  },
});

export const confirmTestCheckout = action({
  args: {
    draftId: v.id("stripeCheckoutDrafts"),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, "caisse", "checkout")) {
      throw new Error("Accès CRM insuffisant.");
    }
    if (args.sessionId === "{CHECKOUT_SESSION_ID}") {
      throw new Error(
        "Stripe n'a pas remplacé le session_id dans l'URL de retour. Relancez le paiement après la mise à jour du flux Checkout.",
      );
    }
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY n'est pas configurée côté Convex. Impossible de vérifier le paiement Stripe.",
      );
    }

    const sessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${args.sessionId}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
    );
    const session = (await sessionResponse.json()) as {
      id?: string;
      metadata?: { draftId?: string };
      payment_status?: string;
      payment_intent?: string;
      status?: string;
      error?: { message?: string };
    };

    if (!sessionResponse.ok || !session.id) {
      throw new Error(
        session.error?.message ||
          "Impossible de récupérer la session Stripe de test.",
      );
    }

    if (session.metadata?.draftId !== args.draftId) {
      throw new Error("Le paiement Stripe ne correspond pas au brouillon attendu.");
    }

    if (session.payment_status !== "paid") {
      throw new Error("Le paiement Stripe test n'est pas marqué comme payé.");
    }

    const result: {
      venteId: Id<"ventes">;
      receiptNumber: string;
      total: number;
      change?: number;
    } = await ctx.runMutation(internal.ventes.finalizeStripeCheckoutDraft, {
      draftId: args.draftId,
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : undefined,
    });

    return result;
  },
});

export const startPublicCartCheckout = action({
  args: {
    articleIds: v.array(v.id("articles")),
    customer: v.object({
      firstName: v.string(),
      lastName: v.string(),
      email: v.string(),
      phone: v.string(),
      address: v.optional(v.string()),
      postalCode: v.optional(v.string()),
      city: v.optional(v.string()),
    }),
    comment: v.optional(v.string()),
    returnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY n'est pas configurée côté Convex. Ajoutez votre clé Stripe test avant d'activer le paiement en ligne.",
      );
    }

    const draft: { draftId: Id<"publicStripeCheckoutDrafts">; total: number } =
      await ctx.runMutation(
      internal.requests.createPublicStripeCheckoutDraft,
      {
        articleIds: args.articleIds,
        customer: args.customer,
        comment: args.comment,
      },
    );

    if (draft.total <= 0) {
      throw new Error(
        "Le montant du panier doit être supérieur à 0 € pour un paiement Stripe test.",
      );
    }

    const successUrl = buildCheckoutReturnUrl(
      args.returnUrl,
      {
        stripe_status: "success",
        draft_id: draft.draftId,
      },
      true,
    );

    const cancelUrl = buildCheckoutReturnUrl(args.returnUrl, {
      stripe_status: "cancelled",
      draft_id: draft.draftId,
    });

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildStripeBody({
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        "payment_method_types[0]": "card",
        locale: "fr",
        customer_email: args.customer.email,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(Math.round(draft.total * 100)),
        "line_items[0][price_data][product_data][name]": "Commande boutique en ligne GDR",
        "line_items[0][price_data][product_data][description]": `${args.articleIds.length} article${args.articleIds.length > 1 ? "s" : ""} depuis la boutique en ligne`,
        "metadata[draftId]": draft.draftId,
      }),
    });

    const payload = (await response.json()) as {
      error?: { message?: string };
      id?: string;
      url?: string;
    };

    if (!response.ok || !payload.id || !payload.url) {
      throw new Error(
        payload.error?.message ||
          "Stripe n'a pas pu créer la session de paiement test.",
      );
    }

    await ctx.runMutation(internal.requests.attachStripeSessionToPublicDraft, {
      draftId: draft.draftId,
      stripeSessionId: payload.id,
    });

    return { checkoutUrl: payload.url };
  },
});

export const confirmPublicCartCheckout = action({
  args: {
    draftId: v.id("publicStripeCheckoutDrafts"),
    sessionId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ requestId: Id<"requests"> }> => {
    if (args.sessionId === "{CHECKOUT_SESSION_ID}") {
      throw new Error(
        "Stripe n'a pas remplacé le session_id dans l'URL de retour. Relancez le paiement après la mise à jour du flux Checkout.",
      );
    }
    const secretKey = env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error(
        "STRIPE_SECRET_KEY n'est pas configurée côté Convex. Impossible de vérifier le paiement Stripe.",
      );
    }

    const sessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${args.sessionId}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`,
        },
      },
    );
    const session = (await sessionResponse.json()) as {
      id?: string;
      metadata?: { draftId?: string };
      payment_status?: string;
      payment_intent?: string;
      error?: { message?: string };
    };

    if (!sessionResponse.ok || !session.id) {
      throw new Error(
        session.error?.message ||
          "Impossible de récupérer la session Stripe de test.",
      );
    }

    if (session.metadata?.draftId !== args.draftId) {
      throw new Error("Le paiement Stripe ne correspond pas au panier attendu.");
    }

    if (session.payment_status !== "paid") {
      throw new Error("Le paiement Stripe test n'est pas marqué comme payé.");
    }

    const result: { requestId: Id<"requests"> } = await ctx.runMutation(
      internal.requests.finalizePublicStripeCheckout,
      {
      draftId: args.draftId,
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : undefined,
      },
    );

    return result;
  },
});
