/**
 * Paniers Bâtire : blocage du stock pendant 30 minutes.
 *
 * Ajouter un article au panier retire aussitôt sa quantité du stock (un autre
 * client ne peut plus l'acheter). Le panier vit 30 minutes après sa dernière
 * modification ; passé ce délai, le stock bloqué est rendu à la vente.
 * À la commande, le blocage devient la commande elle-même : le stock n'est
 * pas décompté une seconde fois (voir `insertOrder` dans batire.ts).
 *
 * Le panier est identifié par une clé aléatoire gardée dans le navigateur
 * (`holderKey`) : on peut remplir un panier avant de se connecter.
 */
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

export const CART_HOLD_MS = 30 * 60_000;
const holderKeyValidator = v.string();

function checkHolderKey(holderKey: string) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(holderKey)) throw new ConvexError("Panier invalide : rechargez la page.");
}

async function holdsOf(ctx: { db: MutationCtx["db"] }, holderKey: string) {
  return await ctx.db.query("btCartHolds").withIndex("by_holder", q => q.eq("holderKey", holderKey)).collect();
}

/** Rend au stock la quantité bloquée par ce panier, puis supprime le blocage. */
export async function releaseHold(ctx: MutationCtx, hold: Doc<"btCartHolds">) {
  const material = await ctx.db.get(hold.materialId);
  if (material) await ctx.db.patch(material._id, { quantity: material.quantity + hold.quantity, status: material.status === "vendu" ? "disponible" : material.status, updatedAt: Date.now() });
  await ctx.db.delete(hold._id);
}

/** Blocages expirés : stock rendu. Appelé avant toute lecture ou écriture d'un panier. */
async function releaseExpired(ctx: MutationCtx, holds: Doc<"btCartHolds">[], now: number) {
  const active: Doc<"btCartHolds">[] = [];
  for (const hold of holds) {
    if (hold.expiresAt <= now) await releaseHold(ctx, hold);
    else active.push(hold);
  }
  return active;
}

/**
 * Prend en charge le blocage de ce panier pour un matériau commandé : la
 * quantité bloquée sert la commande, le complément éventuel est pris au
 * stock. Retourne la quantité encore à décompter du stock.
 */
export async function consumeHold(ctx: MutationCtx, holderKey: string | undefined, materialId: Id<"btMaterials">) {
  if (!holderKey) return 0;
  const hold = await ctx.db.query("btCartHolds").withIndex("by_holder_material", q => q.eq("holderKey", holderKey).eq("materialId", materialId)).unique();
  if (!hold) return 0;
  await ctx.db.delete(hold._id);
  // Blocage expiré mais pas encore nettoyé : son stock est toujours retiré, il sert quand même.
  return hold.quantity;
}

/** Renouvelle la validité de tout le panier (30 min après la dernière modification). */
async function renew(ctx: MutationCtx, holderKey: string, now: number) {
  const expiresAt = now + CART_HOLD_MS;
  for (const hold of await holdsOf(ctx, holderKey)) await ctx.db.patch(hold._id, { expiresAt });
  await ctx.scheduler.runAt(expiresAt + 1_000, internal.batireCart.expireCart, { holderKey });
  return expiresAt;
}

/** Fixe la quantité d'un article dans le panier (0 = retiré) et bloque le stock correspondant. */
export const setCartItem = mutation({
  args: { holderKey: holderKeyValidator, materialId: v.id("btMaterials"), quantity: v.number() },
  handler: async (ctx, { holderKey, materialId, quantity }) => {
    checkHolderKey(holderKey);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) throw new ConvexError("Quantité invalide.");
    const now = Date.now();
    await releaseExpired(ctx, await holdsOf(ctx, holderKey), now);
    const existing = await ctx.db.query("btCartHolds").withIndex("by_holder_material", q => q.eq("holderKey", holderKey).eq("materialId", materialId)).unique();
    const material = await ctx.db.get(materialId);
    if (!material) {
      if (existing) await ctx.db.delete(existing._id);
      throw new ConvexError("Ce matériau n'existe plus.");
    }
    const current = existing?.quantity ?? 0;
    if (quantity === 0) {
      if (existing) await releaseHold(ctx, existing);
      return { expiresAt: await renew(ctx, holderKey, now), quantity: 0 };
    }
    if (!existing && (material.status !== "disponible" || !material.published || material.price <= 0)) throw new ConvexError(`« ${material.title} » n'est plus disponible.`);
    const delta = quantity - current;
    if (delta > material.quantity) {
      const max = Math.round((current + material.quantity) * 100) / 100;
      throw new ConvexError(max > 0 ? `Stock insuffisant : ${max} ${material.unit} disponible pour « ${material.title} ».` : `« ${material.title} » vient d'être réservé par un autre client.`);
    }
    await ctx.db.patch(material._id, { quantity: Math.round((material.quantity - delta) * 1000) / 1000, updatedAt: now });
    if (existing) await ctx.db.patch(existing._id, { quantity });
    else await ctx.db.insert("btCartHolds", { holderKey, materialId, quantity, expiresAt: now + CART_HOLD_MS, createdAt: now });
    return { expiresAt: await renew(ctx, holderKey, now), quantity };
  },
});

/** Vide le panier : tout le stock bloqué redevient disponible. */
export const clearCart = mutation({
  args: { holderKey: holderKeyValidator },
  handler: async (ctx, { holderKey }) => {
    checkHolderKey(holderKey);
    for (const hold of await holdsOf(ctx, holderKey)) await releaseHold(ctx, hold);
  },
});

/** Blocages actifs du panier, avec leur échéance. */
export const cartHolds = query({
  args: { holderKey: holderKeyValidator },
  handler: async (ctx, { holderKey }) => {
    if (!/^[A-Za-z0-9_-]{16,80}$/.test(holderKey)) return [];
    const now = Date.now();
    const holds = await ctx.db.query("btCartHolds").withIndex("by_holder", q => q.eq("holderKey", holderKey)).collect();
    return holds.filter(hold => hold.expiresAt > now).map(hold => ({ materialId: hold.materialId, quantity: hold.quantity, expiresAt: hold.expiresAt }));
  },
});

/** Échéance du panier : stock rendu si le panier n'a pas été renouvelé entre-temps. */
export const expireCart = internalMutation({
  args: { holderKey: v.string() },
  handler: async (ctx, { holderKey }) => {
    await releaseExpired(ctx, await holdsOf(ctx, holderKey), Date.now());
  },
});

/** Filet de sécurité (cron) : blocages expirés oubliés. */
export const releaseStaleHolds = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db.query("btCartHolds").withIndex("by_expiresAt", q => q.lt("expiresAt", Date.now())).take(200);
    for (const hold of stale) await releaseHold(ctx, hold);
  },
});
