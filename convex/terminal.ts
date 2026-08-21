/**
 * Encaissement sans contact en boutique, via Stripe Terminal.
 *
 * ⚠️ « Tap to Pay » (le téléphone du vendeur en guise de terminal) n'est PAS
 * accessible depuis un navigateur : Stripe ne le propose que par ses SDK iOS et
 * Android, donc depuis une application native. Ce module pilote donc un LECTEUR
 * Stripe Terminal (WisePOS E, Stripe Reader S700, ou un téléphone enregistré
 * comme lecteur Tap to Pay par l'app Stripe) : le CRM crée le PaymentIntent au
 * montant exact et le pousse sur le lecteur, qui affiche la somme et attend le
 * sans-contact. Aucun montant n'est saisi à la main sur le terminal.
 *
 * Tant qu'aucun lecteur n'est enregistré sur le compte Stripe, la caisse
 * propose les autres moyens de paiement et explique ce qu'il manque.
 */
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { accessAllows } from "./lib";
import { recycappSecretKey, stripeRequest } from "./stripe";

type Reader = {
  id: string;
  label: string | null;
  status: string | null;
  deviceType: string | null;
};

async function requireCaisseAccess(ctx: ActionCtx) {
  const access = await ctx.runQuery(api.permissions.myAccess, {});
  if (!accessAllows(access, "caisse", "checkout")) {
    throw new ConvexError("Accès CRM insuffisant.");
  }
}

/** Lecteurs enregistrés sur le compte Stripe. Liste vide = pas de matériel. */
export const listReaders = action({
  args: {},
  handler: async (ctx): Promise<Reader[]> => {
    await requireCaisseAccess(ctx);
    const secretKey = recycappSecretKey();
    const response = await stripeRequest<{
      data?: Array<{
        id?: string;
        label?: string;
        status?: string;
        device_type?: string;
      }>;
    }>("terminal/readers?limit=20", secretKey);

    return (response.data ?? [])
      .filter((reader): reader is { id: string } & typeof reader =>
        typeof reader.id === "string",
      )
      .map((reader) => ({
        id: reader.id,
        label: reader.label ?? null,
        status: reader.status ?? null,
        deviceType: reader.device_type ?? null,
      }));
  },
});

/**
 * Pousse le montant sur le lecteur et attend le sans-contact.
 *
 * Le PaymentIntent est créé ici, au montant calculé côté serveur : le vendeur
 * ne tape jamais de somme sur le terminal, donc pas d'écart possible entre le
 * panier et ce qui est débité.
 */
export const collectOnReader = action({
  args: {
    readerId: v.string(),
    amount: v.number(),
    description: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ paymentIntentId: string; status: string }> => {
    await requireCaisseAccess(ctx);
    const secretKey = recycappSecretKey();

    const amountCents = Math.round(args.amount * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new ConvexError("Le montant à encaisser doit être supérieur à 0 €.");
    }

    const intent = await stripeRequest<{ id: string; status: string }>(
      "payment_intents",
      secretKey,
      {
        amount: String(amountCents),
        currency: "eur",
        "payment_method_types[0]": "card_present",
        capture_method: "automatic",
        description: args.description ?? "Vente en boutique",
        "metadata[source]": "recycapp-caisse",
      },
    );

    await stripeRequest(
      `terminal/readers/${args.readerId}/process_payment_intent`,
      secretKey,
      { payment_intent: intent.id },
    );

    return { paymentIntentId: intent.id, status: intent.status };
  },
});

/** État d'un encaissement en cours : la caisse interroge jusqu'au succès. */
export const paymentStatus = action({
  args: { paymentIntentId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: string; lastError: string | null }> => {
    await requireCaisseAccess(ctx);
    const secretKey = recycappSecretKey();
    const intent = await stripeRequest<{
      status?: string;
      last_payment_error?: { message?: string };
    }>(`payment_intents/${args.paymentIntentId}`, secretKey);

    return {
      status: intent.status ?? "unknown",
      lastError: intent.last_payment_error?.message ?? null,
    };
  },
});

/** Annule l'encaissement en cours et libère le lecteur. */
export const cancelOnReader = action({
  args: { readerId: v.string(), paymentIntentId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<null> => {
    await requireCaisseAccess(ctx);
    const secretKey = recycappSecretKey();
    await stripeRequest(
      `terminal/readers/${args.readerId}/cancel_action`,
      secretKey,
      {},
    ).catch(() => null);
    if (args.paymentIntentId) {
      await stripeRequest(
        `payment_intents/${args.paymentIntentId}/cancel`,
        secretKey,
        {},
      ).catch(() => null);
    }
    return null;
  },
});
