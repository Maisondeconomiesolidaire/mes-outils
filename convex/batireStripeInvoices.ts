/**
 * Factures Stripe des demandes Bâtire.
 *
 * Toute demande réglée reçoit une facture émise par Stripe, sur le compte du
 * vendeur (Recyclerie pour le mobilier, MATERIOSOL pour le reste) :
 *  - carte : la facture que Checkout crée avec le paiement (`invoice_creation`) ;
 *  - espèces / virement (ou ancien paiement carte sans facture) : une facture
 *    créée ici puis marquée « payée hors Stripe » (`paid_out_of_band`).
 * Le client la reçoit ensuite par e-mail (PDF Stripe en pièce jointe).
 * Bâtire n'émet plus de facture maison.
 */
import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { accessAllows, requireCrmPermission } from "./lib";
import { stripeRequest } from "./stripe";
import { bytesToBase64 } from "./emails";
import { sendStripeInvoiceMail } from "./batireEmails";
import { PAGE_DEMANDES, PAYMENT_LABELS, completeClient, stripeKeyForProvider, stripeProviderForCategory } from "./batire";

type Provider = "recycapp" | "bennespro";
type StripeInvoice = {
  id: string; number?: string | null; status?: string | null; total?: number;
  hosted_invoice_url?: string | null; invoice_pdf?: string | null;
  status_transitions?: { paid_at?: number | null };
};
type Session = { invoice?: string | null; invoice_creation?: { enabled?: boolean } | null };

const ISSUER_NAMES: Record<Provider, string> = { recycapp: "Recyclerie du Pays de Bray", bennespro: "MATERIOSOL" };
const euros = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const frDate = (at: number) => new Date(at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
const reference = (order: Doc<"btOrders">) => order.pickupReference ?? order.purchaseReference ?? order.reference;

/** Lignes de la facture : lot, transfert, remise du code promo, au montant réellement encaissé. */
function invoiceLines(order: Doc<"btOrders">) {
  const fee = order.pickupFeeCents ?? 0;
  const discount = order.discountCents ?? 0;
  const goods = order.amountCents - fee + discount;
  return [
    { description: `${order.materialTitle} — ${order.quantity} ${order.unit}`, amount: goods },
    ...(fee ? [{ description: "Transfert vers le lieu de retrait", amount: fee }] : []),
    ...(discount ? [{ description: `Remise${order.promoCode ? ` · code ${order.promoCode}` : ""}`, amount: -discount }] : []),
  ];
}

export const invoiceContext = internalQuery({
  args: { orderId: v.id("btOrders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    const material = await ctx.db.get(order.materialId);
    const { company, firstName, lastName, email, phone } = order.customer;
    const client = await completeClient(ctx, { company, firstName, lastName, email, phone }, { userId: order.userId });
    // Panier payé par carte : une seule session Checkout, donc une seule facture pour ses demandes.
    const sessionOrderIds = order.stripeSessionId
      ? (await ctx.db.query("btOrders").withIndex("by_stripeSession", q => q.eq("stripeSessionId", order.stripeSessionId)).collect()).map(row => row._id)
      : [order._id];
    return { order, category: material?.category ?? "", client, sessionOrderIds };
  },
});

/** Verrou anti-doublon : une seule création de facture à la fois par demande. */
export const claimInvoiceCreation = internalMutation({
  args: { orderId: v.id("btOrders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.stripeInvoiceId) return false;
    const now = Date.now();
    if (order.stripeInvoicePendingAt && now - order.stripeInvoicePendingAt < 5 * 60_000) return false;
    await ctx.db.patch(orderId, { stripeInvoicePendingAt: now, stripeInvoiceError: undefined });
    return true;
  },
});

export const saveInvoice = internalMutation({
  args: {
    orderIds: v.array(v.id("btOrders")),
    provider: v.union(v.literal("recycapp"), v.literal("bennespro")),
    invoice: v.object({ id: v.string(), number: v.optional(v.string()), status: v.optional(v.string()), url: v.optional(v.string()), pdfUrl: v.optional(v.string()), totalCents: v.optional(v.number()) }),
  },
  handler: async (ctx, { orderIds, provider, invoice }) => {
    for (const id of orderIds) {
      const order = await ctx.db.get(id);
      if (!order || (order.stripeInvoiceId && order.stripeInvoiceId !== invoice.id)) continue;
      await ctx.db.patch(id, {
        stripeInvoiceId: invoice.id, stripeInvoiceProvider: provider, stripeInvoiceNumber: invoice.number,
        stripeInvoiceStatus: invoice.status, stripeInvoiceUrl: invoice.url, stripeInvoicePdfUrl: invoice.pdfUrl,
        stripeInvoiceTotalCents: invoice.totalCents, stripeInvoicePendingAt: undefined, stripeInvoiceError: undefined,
      });
    }
  },
});

export const failInvoice = internalMutation({
  args: { orderId: v.id("btOrders"), error: v.string() },
  handler: async (ctx, { orderId, error }) => {
    await ctx.db.patch(orderId, { stripeInvoicePendingAt: undefined, stripeInvoiceError: error.slice(0, 300) });
  },
});

/** Envoi unique par facture (un panier = plusieurs demandes, une facture) ; `force` pour un renvoi. */
export const claimInvoiceEmail = internalMutation({
  args: { invoiceId: v.string(), orderIds: v.array(v.id("btOrders")), force: v.boolean() },
  handler: async (ctx, { invoiceId, orderIds, force }) => {
    const orders = (await Promise.all(orderIds.map(id => ctx.db.get(id)))).filter((row): row is Doc<"btOrders"> => Boolean(row) && row!.stripeInvoiceId === invoiceId);
    if (!force && orders.some(row => row.invoiceSentAt)) return false;
    const now = Date.now();
    for (const row of orders) await ctx.db.patch(row._id, { invoiceSentAt: now });
    return true;
  },
});

export const markInvoiceEmail = internalMutation({
  args: { invoiceId: v.string(), orderIds: v.array(v.id("btOrders")), sentAt: v.optional(v.number()), to: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { invoiceId, orderIds, sentAt, to, error }) => {
    for (const id of orderIds) {
      const row = await ctx.db.get(id);
      if (row?.stripeInvoiceId !== invoiceId) continue;
      await ctx.db.patch(id, { invoiceSentAt: sentAt, invoiceSentTo: to ?? row.invoiceSentTo, stripeInvoiceError: error });
    }
  },
});

/** Coordonnées complètes d'un acheteur (compte boutique) pour sa fiche client Stripe. */
export const checkoutClient = internalQuery({
  args: { userId: v.optional(v.string()), customer: v.object({ company: v.optional(v.string()), firstName: v.string(), lastName: v.string(), email: v.string(), phone: v.optional(v.string()) }) },
  handler: async (ctx, { userId, customer }) => {
    const { company, firstName, lastName, email, phone } = customer;
    return await completeClient(ctx, { company, firstName, lastName, email, phone }, { userId });
  },
});

/**
 * Client Stripe RÉEL pour un paiement (jamais un « invité ») : celui qui
 * existe déjà avec cet e-mail sur ce compte Stripe, sinon une fiche créée.
 */
export async function checkoutCustomer(ctx: ActionCtx, key: string, userId: string | undefined, customer: { company?: string; firstName: string; lastName: string; email: string; phone?: string }) {
  const client = await ctx.runQuery(internal.batireStripeInvoices.checkoutClient, { userId, customer });
  return await findOrCreateCustomer(key, client, customer.email.trim().toLowerCase(), userId);
}

async function findOrCreateCustomer(key: string, client: Awaited<ReturnType<typeof completeClient>>, email: string, userId?: string) {
  const found = await stripeRequest<{ data: { id: string }[] }>(`customers?limit=1&email=${encodeURIComponent(email)}`, key);
  if (found.data[0]) return found.data[0].id;
  const name = client.company || [client.firstName, client.lastName].filter(Boolean).join(" ").trim() || email;
  const body: Record<string, string> = { email, name, "preferred_locales[0]": "fr", "metadata[source]": "batire" };
  if (userId) body["metadata[clerkId]"] = userId;
  if (client.phone) body.phone = client.phone;
  if (client.address) {
    body["address[line1]"] = client.address;
    if (client.postalCode) body["address[postal_code]"] = client.postalCode;
    if (client.city) body["address[city]"] = client.city;
    body["address[country]"] = "FR";
  }
  return (await stripeRequest<{ id: string }>("customers", key, body)).id;
}

/** Facture créée puis marquée payée hors Stripe (espèces, virement…). */
async function createPaidInvoice(key: string, context: NonNullable<Awaited<ReturnType<typeof loadContext>>>) {
  const { order, client } = context;
  const email = (client.email ?? order.customer.email).toLowerCase();
  const customer = await findOrCreateCustomer(key, client, email);
  const method = PAYMENT_LABELS[order.paymentMethod ?? "card"] ?? "Carte bancaire";
  const draft = await stripeRequest<StripeInvoice>("invoices", key, {
    customer,
    currency: "eur",
    collection_method: "charge_automatically",
    auto_advance: "false",
    pending_invoice_items_behavior: "exclude",
    description: `Demande Bâtire #${reference(order)}`,
    footer: `Facture réglée le ${frDate(order.paidAt ?? Date.now())} · ${method}.`,
    "metadata[orderId]": String(order._id),
    "metadata[source]": "batire-paiement",
    "metadata[paymentMethod]": order.paymentMethod ?? "card",
  });
  for (const line of invoiceLines(order)) {
    await stripeRequest("invoiceitems", key, { customer, invoice: draft.id, currency: "eur", amount: String(line.amount), description: line.description.slice(0, 250) });
  }
  let invoice = await stripeRequest<StripeInvoice>(`invoices/${draft.id}/finalize`, key, { auto_advance: "false" });
  if (invoice.status !== "paid") invoice = await stripeRequest<StripeInvoice>(`invoices/${draft.id}/pay`, key, { paid_out_of_band: "true" });
  return invoice;
}

/** Appel Stripe avec une version d'API explicite (paiements de facture, API « basil »). */
async function stripeVersioned<T>(path: string, key: string, body: Record<string, string>, version = "2025-03-31.basil"): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": version },
    body: new URLSearchParams(body),
  });
  const payload = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || "Erreur Stripe.");
  return payload;
}

/** Facture déjà émise chez Stripe pour cette demande (créée par Bâtire, métadonnée orderId). */
async function findExistingInvoice(key: string, orderId: string) {
  try {
    const found = await stripeRequest<{ data: StripeInvoice[] }>(`invoices/search?limit=1&query=${encodeURIComponent(`metadata['orderId']:'${orderId}'`)}`, key);
    return found.data.find(invoice => invoice.status !== "void" && invoice.status !== "draft") ?? null;
  } catch { return null; }
}

/**
 * Paiement carte encaissé avant la facturation Checkout : la facture est
 * créée puis le paiement carte EXISTANT lui est rattaché (`attach_payment`).
 * Aucun nouvel encaissement, donc aucun doublon comptable. Si Stripe refuse
 * le rattachement, la facture est annulée (void) et rien n'est compté.
 */
async function createCardInvoice(key: string, context: NonNullable<Awaited<ReturnType<typeof loadContext>>>, paymentIntentId: string, paymentCustomer: string | null) {
  const { order, client } = context;
  const customer = paymentCustomer ?? await findOrCreateCustomer(key, client, (client.email ?? order.customer.email).toLowerCase(), order.userId);
  const draft = await stripeRequest<StripeInvoice>("invoices", key, {
    customer, currency: "eur", collection_method: "charge_automatically", auto_advance: "false", pending_invoice_items_behavior: "exclude",
    description: `Demande Bâtire #${reference(order)}`,
    footer: `Facture réglée le ${frDate(order.paidAt ?? Date.now())} · Carte bancaire.`,
    "metadata[orderId]": String(order._id), "metadata[source]": "batire-paiement", "metadata[paymentMethod]": "card", "metadata[paymentIntent]": paymentIntentId,
  });
  for (const line of invoiceLines(order)) {
    await stripeRequest("invoiceitems", key, { customer, invoice: draft.id, currency: "eur", amount: String(line.amount), description: line.description.slice(0, 250) });
  }
  await stripeRequest<StripeInvoice>(`invoices/${draft.id}/finalize`, key, { auto_advance: "false" });
  try {
    await stripeVersioned(`invoices/${draft.id}/attach_payment`, key, { payment_intent: paymentIntentId });
  } catch (error) {
    try { await stripeRequest(`invoices/${draft.id}/void`, key, {}); } catch { /* déjà annulée */ }
    throw new ConvexError(`Stripe n'a pas pu rattacher le paiement carte existant à la facture (${error instanceof Error ? error.message : String(error)}). Aucune facture ni aucun encaissement n'a été créé.`);
  }
  const invoice = await stripeRequest<StripeInvoice>(`invoices/${draft.id}`, key);
  if (invoice.status !== "paid") {
    try { await stripeRequest(`invoices/${draft.id}/void`, key, {}); } catch { /* rien à annuler */ }
    throw new ConvexError("Le paiement carte n'a pas soldé la facture (montant différent ?). Facture annulée, aucun encaissement créé.");
  }
  return invoice;
}

async function loadContext(ctx: ActionCtx, orderId: Id<"btOrders">) {
  return await ctx.runQuery(internal.batireStripeInvoices.invoiceContext, { orderId });
}

const savedShape = (invoice: StripeInvoice) => ({
  id: invoice.id, number: invoice.number ?? undefined, status: invoice.status ?? undefined,
  url: invoice.hosted_invoice_url ?? undefined, pdfUrl: invoice.invoice_pdf ?? undefined, totalCents: invoice.total,
});

/**
 * Facture Stripe d'une demande payée (créée si besoin). Renvoie `null` si une
 * création est déjà en cours, ou si Stripe n'a pas encore produit la facture
 * Checkout (nouvel essai planifié).
 */
async function ensureInvoice(ctx: ActionCtx, orderId: Id<"btOrders">, attempt: number) {
  const context = await loadContext(ctx, orderId);
  if (!context) throw new ConvexError("Demande introuvable.");
  const { order } = context;
  if (order.status !== "payee") throw new ConvexError("La demande n’est pas payée.");
  let provider: Provider = order.stripeInvoiceProvider ?? stripeProviderForCategory(context.category);
  let key = stripeKeyForProvider(provider);
  if (order.stripeInvoiceId) {
    const invoice = await stripeRequest<StripeInvoice>(`invoices/${order.stripeInvoiceId}`, key);
    const orderIds = [order._id];
    await ctx.runMutation(internal.batireStripeInvoices.saveInvoice, { orderIds, provider, invoice: savedShape(invoice) });
    return { invoice, provider, context, orderIds };
  }
  // Carte : la facture créée par Checkout avec le paiement.
  if ((order.paymentMethod ?? "card") === "card" && order.stripeSessionId) {
    // La session peut vivre sur l'autre compte Stripe (anciennes commandes) :
    // on la cherche sur les deux, et la facture suit le compte qui a encaissé.
    let session: Session | null = null;
    for (const candidate of [provider, provider === "recycapp" ? "bennespro" : "recycapp"] as Provider[]) {
      let candidateKey: string;
      try { candidateKey = stripeKeyForProvider(candidate); } catch { continue; }
      try {
        session = await stripeRequest<Session>(`checkout/sessions/${order.stripeSessionId}`, candidateKey);
        provider = candidate; key = candidateKey;
        break;
      } catch (error) {
        if (!/no such checkout\.session/i.test(error instanceof Error ? error.message : "")) throw error;
      }
    }
    if (session?.invoice) {
      const invoice = await stripeRequest<StripeInvoice>(`invoices/${session.invoice}`, key);
      await ctx.runMutation(internal.batireStripeInvoices.saveInvoice, { orderIds: context.sessionOrderIds, provider, invoice: savedShape(invoice) });
      return { invoice, provider, context, orderIds: context.sessionOrderIds };
    }
    if (session?.invoice_creation?.enabled && attempt < 5) {
      await ctx.scheduler.runAfter(60_000, internal.batireStripeInvoices.issueOrderInvoice, { orderId, attempt: attempt + 1 });
      return null;
    }
    if (!session) throw new ConvexError("Paiement carte introuvable sur les comptes Stripe : impossible d'émettre la facture sans créer de doublon.");
  }
  // Facture déjà émise chez Stripe pour cette demande : on la reprend telle quelle.
  const existing = await findExistingInvoice(key, String(orderId));
  if (existing) {
    await ctx.runMutation(internal.batireStripeInvoices.saveInvoice, { orderIds: [orderId], provider, invoice: savedShape(existing) });
    return { invoice: existing, provider, context, orderIds: [orderId] };
  }
  const card = (order.paymentMethod ?? "card") === "card";
  let paymentIntent: { id: string; status?: string; customer?: string | { id: string } | null; invoice?: string | null } | null = null;
  if (card) {
    if (!order.stripePaymentIntentId) throw new ConvexError("Paiement carte sans référence Stripe : impossible d'émettre la facture sans créer de doublon.");
    paymentIntent = await stripeRequest(`payment_intents/${order.stripePaymentIntentId}`, key);
    // Paiement déjà rattaché à une facture Stripe : on la récupère.
    if (paymentIntent?.invoice) {
      const invoice = await stripeRequest<StripeInvoice>(`invoices/${paymentIntent.invoice}`, key);
      await ctx.runMutation(internal.batireStripeInvoices.saveInvoice, { orderIds: [orderId], provider, invoice: savedShape(invoice) });
      return { invoice, provider, context, orderIds: [orderId] };
    }
    if (paymentIntent?.status !== "succeeded") throw new ConvexError("Le paiement carte n'est pas encaissé chez Stripe.");
  }
  if (!(await ctx.runMutation(internal.batireStripeInvoices.claimInvoiceCreation, { orderId }))) return null;
  try {
    const paymentCustomer = typeof paymentIntent?.customer === "string" ? paymentIntent.customer : paymentIntent?.customer?.id ?? null;
    // Carte : facture rattachée au paiement existant. Espèces / virement : payée hors Stripe.
    const invoice = card ? await createCardInvoice(key, context, paymentIntent!.id, paymentCustomer) : await createPaidInvoice(key, context);
    await ctx.runMutation(internal.batireStripeInvoices.saveInvoice, { orderIds: [orderId], provider, invoice: savedShape(invoice) });
    // ⚠ `provider` peut différer de la catégorie : c'est le compte qui a encaissé.
    return { invoice, provider, context, orderIds: [orderId] };
  } catch (error) {
    await ctx.runMutation(internal.batireStripeInvoices.failInvoice, { orderId, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

/** E-mail au client : PDF Stripe joint + lien vers la facture en ligne. */
async function emailInvoice(ctx: ActionCtx, issued: NonNullable<Awaited<ReturnType<typeof ensureInvoice>>>, force: boolean, to?: string) {
  const { invoice, provider, context, orderIds } = issued;
  if (!(await ctx.runMutation(internal.batireStripeInvoices.claimInvoiceEmail, { invoiceId: invoice.id, orderIds, force }))) return null;
  const recipient = (to ?? context.client.email ?? context.order.customer.email).trim().toLowerCase();
  try {
    let pdfBase64: string | undefined;
    if (invoice.invoice_pdf) {
      const response = await fetch(invoice.invoice_pdf);
      if (response.ok) pdfBase64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
    }
    const { client, order } = context;
    const ok = await sendStripeInvoiceMail({
      to: recipient,
      name: client.company ? "" : [client.firstName, client.lastName].filter(Boolean).join(" "),
      number: invoice.number ?? invoice.id,
      issuerName: ISSUER_NAMES[provider],
      total: euros(invoice.total ?? order.amountCents),
      paidOn: frDate(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : order.paidAt ?? Date.now()),
      method: PAYMENT_LABELS[order.paymentMethod ?? "card"] ?? "Carte bancaire",
      url: invoice.hosted_invoice_url ?? undefined,
      pdfBase64,
    });
    if (!ok) throw new Error("L’e-mail n’a pas pu être envoyé.");
    await ctx.runMutation(internal.batireStripeInvoices.markInvoiceEmail, { invoiceId: invoice.id, orderIds, sentAt: Date.now(), to: recipient });
    return recipient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await ctx.runMutation(internal.batireStripeInvoices.markInvoiceEmail, { invoiceId: invoice.id, orderIds, error: `Envoi : ${message}`.slice(0, 300) });
    throw error;
  }
}

/** Planifiée par `markOrderPaid` : facture Stripe émise et envoyée au client. */
export const issueOrderInvoice = internalAction({
  args: { orderId: v.id("btOrders"), attempt: v.optional(v.number()) },
  handler: async (ctx, { orderId, attempt }) => {
    const issued = await ensureInvoice(ctx, orderId, attempt ?? 0);
    if (issued) await emailInvoice(ctx, issued, false);
  },
});

/** CRM : émet la facture Stripe si elle manque, puis l'envoie (ou la renvoie) au client. */
export const sendOrderInvoice = action({
  args: { orderId: v.id("btOrders"), to: v.optional(v.string()) },
  handler: async (ctx, { orderId, to }): Promise<{ number: string; to: string }> => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, PAGE_DEMANDES, "update")) throw new ConvexError("Accès CRM insuffisant.");
    if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) throw new ConvexError("Adresse e-mail invalide.");
    try {
      const issued = await ensureInvoice(ctx, orderId, 5);
      if (!issued) throw new ConvexError("La facture est en cours de création chez Stripe. Réessayez dans un instant.");
      const sent = await emailInvoice(ctx, issued, true, to);
      return { number: issued.invoice.number ?? issued.invoice.id, to: sent ?? "" };
    } catch (error) {
      // Message lisible dans le CRM plutôt qu'un « Server Error » opaque.
      if (error instanceof ConvexError) throw error;
      throw new ConvexError(`Stripe : ${error instanceof Error ? error.message : String(error)}`);
    }
  },
});

/** Facture Stripe d'une demande (étape « Payé » et onglet Facturation). */
export const orderInvoice = query({
  args: { orderId: v.id("btOrders") },
  handler: async (ctx, { orderId }) => {
    await requireCrmPermission(ctx, PAGE_DEMANDES, "read");
    const order = await ctx.db.get(orderId);
    if (!order) return null;
    return {
      id: order.stripeInvoiceId ?? null, number: order.stripeInvoiceNumber ?? null, status: order.stripeInvoiceStatus ?? null,
      url: order.stripeInvoiceUrl ?? null, pdfUrl: order.stripeInvoicePdfUrl ?? null, totalCents: order.stripeInvoiceTotalCents ?? null,
      issuer: order.stripeInvoiceProvider ? ISSUER_NAMES[order.stripeInvoiceProvider] : null,
      sentAt: order.invoiceSentAt ?? null, sentTo: order.invoiceSentTo ?? null,
      pending: Boolean(order.stripeInvoicePendingAt && Date.now() - order.stripeInvoicePendingAt < 5 * 60_000),
      error: order.stripeInvoiceError ?? null,
    };
  },
});

/** Page Facturation : factures Stripe des demandes, de la plus récente à la plus ancienne. */
export const listOrderInvoices = query({
  args: {},
  handler: async ctx => {
    await requireCrmPermission(ctx, PAGE_DEMANDES, "read");
    const orders = await ctx.db.query("btOrders").withIndex("by_status", q => q.eq("status", "payee")).order("desc").take(1000);
    const seen = new Set<string>();
    const rows = [];
    for (const order of orders) {
      if (!order.stripeInvoiceId || seen.has(order.stripeInvoiceId)) continue;
      seen.add(order.stripeInvoiceId);
      rows.push({
        id: order.stripeInvoiceId, orderId: order._id, number: order.stripeInvoiceNumber ?? order.stripeInvoiceId,
        issuer: order.stripeInvoiceProvider ?? "bennespro", status: order.stripeInvoiceStatus ?? null,
        url: order.stripeInvoiceUrl ?? null, pdfUrl: order.stripeInvoicePdfUrl ?? null,
        totalCents: order.stripeInvoiceTotalCents ?? order.amountCents, paidAt: order.paidAt ?? null,
        paymentMethod: PAYMENT_LABELS[order.paymentMethod ?? "card"] ?? "Carte bancaire",
        client: order.customer.company || `${order.customer.firstName} ${order.customer.lastName}`.trim(),
        email: order.customer.email, reference: reference(order), sentAt: order.invoiceSentAt ?? null,
      });
    }
    return rows;
  },
});
