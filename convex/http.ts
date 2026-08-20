import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

const http = httpRouter();

/**
 * Sert un fichier du stockage Convex en octets directs (HTTP 200, sans
 * redirection signée) — fiable pour les images d'emails (proxy Gmail, etc.).
 * Exemple : GET /email/image?id=<storageId>
 */
http.route({
  path: "/email/image",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return new Response("Missing id", { status: 400 });
    const blob = await ctx.storage.get(id as Id<"_storage">);
    if (!blob) return new Response("Not found", { status: 404 });
    return new Response(blob, {
      status: 200,
      headers: {
        "Content-Type": blob.type || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }),
});

/* ─── Webhook Stripe — boutique en ligne Recycapp ──────────────────────────
 *
 * Stripe nous appelle directement, sans passer par le navigateur du client :
 * c'est ce qui garantit que la commande est enregistrée même si l'acheteur
 * ferme son onglet, si le retour de 3-D Secure échoue, ou si le moyen de
 * paiement se confirme de façon différée (SEPA, wallets…).
 *
 * URL à déclarer dans Stripe :
 *   https://hip-marten-394.eu-west-1.convex.site/stripe/recycapp
 */

/** Comparaison à temps constant : ne fuite pas la signature attendue. */
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Vérifie l'en-tête `Stripe-Signature` (schéma v1 : HMAC-SHA256 de
 * « timestamp.payload »). Sans cette vérification, n'importe qui pourrait
 * poster une fausse confirmation de paiement.
 */
async function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.split("=");
      return [key.trim(), rest.join("=")];
    }),
  ) as { t?: string; v1?: string };
  if (!parts.t || !parts.v1) return false;

  // Rejoue impossible au-delà de 5 minutes.
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${parts.t}.${payload}`),
  );
  return timingSafeEqual(toHex(signature), parts.v1);
}

http.route({
  path: "/stripe/recycapp",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = env.RECYCAPP_STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error("Webhook Stripe reçu mais RECYCAPP_STRIPE_WEBHOOK_SECRET n'est pas configurée.");
      return new Response("Webhook non configuré", { status: 500 });
    }

    // Le corps brut est indispensable : la signature porte sur les octets reçus.
    const payload = await request.text();
    const valid = await verifyStripeSignature(
      payload,
      request.headers.get("Stripe-Signature"),
      secret,
    );
    if (!valid) return new Response("Signature invalide", { status: 400 });

    const event = JSON.parse(payload) as {
      type?: string;
      data?: { object?: { id?: string; status?: string; metadata?: { draftId?: string } } };
    };
    const intent = event.data?.object;

    if (event.type !== "payment_intent.succeeded") {
      // Les autres événements sont acquittés sans traitement.
      return new Response("ok", { status: 200 });
    }

    const draftId = intent?.metadata?.draftId;
    if (!draftId || !intent?.id) {
      console.error("payment_intent.succeeded sans draftId exploitable.");
      return new Response("ok", { status: 200 });
    }

    try {
      // Idempotent : si la commande a déjà été créée par le navigateur, la
      // mutation renvoie simplement la demande existante.
      await ctx.runMutation(internal.requests.finalizePublicStripeCheckout, {
        draftId: draftId as Id<"publicStripeCheckoutDrafts">,
        stripePaymentIntentId: intent.id,
      });
      return new Response("ok", { status: 200 });
    } catch (error) {
      // Un échec ici = un client débité sans commande (article vendu entre
      // temps, par exemple). On renvoie une erreur pour que Stripe réessaie et
      // que l'incident reste visible dans le dashboard.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Finalisation impossible pour le brouillon ${draftId} : ${message}`);
      return new Response(message, { status: 500 });
    }
  }),
});

export default http;
