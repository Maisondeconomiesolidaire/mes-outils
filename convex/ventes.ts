import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireCrmPermission } from "./lib";
import type { Id } from "./_generated/dataModel";

const saleItemValidator = v.object({
  articleId: v.id("articles"),
  title: v.string(),
  price: v.number(),
});

async function nextReceiptNumber(ctx: MutationCtx) {
  const all = await ctx.db.query("ventes").collect();
  const n = all.length + 1;
  return `TK-${String(n).padStart(5, "0")}`;
}

async function recordVente(
  ctx: MutationCtx,
  args: {
    items: { articleId: Id<"articles">; title: string; price: number }[];
    discountAmount?: number;
    paymentMethod: "especes" | "cb" | "cheque" | "cheque_cadeau" | "virement";
    amountTendered?: number;
  },
) {
  const subtotal = args.items.reduce((s, i) => s + i.price, 0);
  const discount = args.discountAmount ?? 0;
  const total = Math.max(0, subtotal - discount);
  const change =
    args.amountTendered !== undefined
      ? Math.max(0, args.amountTendered - total)
      : undefined;

  const receiptNumber = await nextReceiptNumber(ctx);

  const venteId = await ctx.db.insert("ventes", {
    date: Date.now(),
    receiptNumber,
    items: args.items,
    subtotal,
    discountAmount: discount > 0 ? discount : undefined,
    total,
    paymentMethod: args.paymentMethod,
    amountTendered: args.amountTendered,
    change,
    createdAt: Date.now(),
  });

  await Promise.all(
    args.items.map((item) => ctx.db.patch(item.articleId, { status: "vendu" })),
  );

  return { venteId, receiptNumber, total, change };
}

export const createVente = mutation({
  args: {
    items: v.array(saleItemValidator),
    discountAmount: v.optional(v.number()),
    paymentMethod: v.union(
      v.literal("especes"),
      v.literal("cb"),
      v.literal("cheque"),
      v.literal("cheque_cadeau"),
      v.literal("virement"),
    ),
    amountTendered: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "caisse", "checkout");
    return await recordVente(ctx, args);
  },
});

export const listVentes = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, { startDate, endDate }) => {
    await requireCrmPermission(ctx, "caisse", "read");
    return await ctx.db
      .query("ventes")
      .withIndex("by_date", (q) => q.gte("date", startDate).lte("date", endDate))
      .order("desc")
      .collect();
  },
});

export const ventesStats = query({
  args: { startDate: v.number(), endDate: v.number() },
  handler: async (ctx, { startDate, endDate }) => {
    await requireCrmPermission(ctx, "caisse", "read");
    const ventes = await ctx.db
      .query("ventes")
      .withIndex("by_date", (q) => q.gte("date", startDate).lte("date", endDate))
      .collect();

    const totalRevenue = ventes.reduce((s, v) => s + v.total, 0);
    const totalArticles = ventes.reduce((s, v) => s + v.items.length, 0);
    const byPayment: Record<string, number> = {};
    for (const v of ventes) {
      byPayment[v.paymentMethod] = (byPayment[v.paymentMethod] ?? 0) + v.total;
    }

    return {
      count: ventes.length,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalArticles,
      byPayment,
    };
  },
});

export const getArticleByReference = query({
  args: { reference: v.string() },
  handler: async (ctx, { reference }) => {
    await requireCrmPermission(ctx, "caisse", "read");
    // Try internalReference index first, then gdrReference
    let found = await ctx.db
      .query("articles")
      .withIndex("by_internalReference", (q) => q.eq("internalReference", reference))
      .first();
    if (!found) {
      found = await ctx.db
        .query("articles")
        .withIndex("by_gdrReference", (q) => q.eq("gdrReference", reference))
        .first();
    }
    if (!found) return null;
    const imageUrls = await Promise.all(
      found.images.map((id: Id<"_storage">) => ctx.storage.getUrl(id)),
    );
    return { ...found, imageUrls: imageUrls.filter(Boolean) as string[] };
  },
});

export const searchArticlesForSale = query({
  args: { searchText: v.string() },
  handler: async (ctx, { searchText }) => {
    await requireCrmPermission(ctx, "caisse", "read");
    const normalized = searchText.trim().toLowerCase();
    if (normalized.length < 2) {
      return [];
    }

    const digitSearch = searchText.replace(/\D/g, "");
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_status", (q) => q.eq("status", "disponible"))
      .order("desc")
      .take(50);

    const matches = articles
      .filter((article) => {
        const haystack = [
          article.title,
          article.internalReference,
          article.gdrReference,
          article.category,
          article.subcategory,
        ]
          .filter((value): value is string => Boolean(value))
          .map((value) => value.trim().toLowerCase());

        const textMatch = haystack.some((value) => value.includes(normalized));
        const digitMatch =
          digitSearch.length > 0 &&
          [article.internalReference, article.gdrReference]
            .filter((value): value is string => Boolean(value))
            .map((value) => value.replace(/\D/g, ""))
            .some((value) => value.includes(digitSearch));

        return textMatch || digitMatch;
      })
      .slice(0, 8);

    return await Promise.all(
      matches.map(async (article) => {
        const imageUrls = await Promise.all(
          article.images.map((id: Id<"_storage">) => ctx.storage.getUrl(id)),
        );
        return {
          _id: article._id,
          title: article.title,
          price: article.price,
          reference: article.internalReference ?? article.gdrReference ?? "",
          imageUrls: imageUrls.filter(Boolean) as string[],
        };
      }),
    );
  },
});

export const createStripeCheckoutDraft = internalMutation({
  args: {
    items: v.array(saleItemValidator),
    discountAmount: v.optional(v.number()),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    const subtotal = args.items.reduce((sum, item) => sum + item.price, 0);
    const total = Math.max(0, subtotal - (args.discountAmount ?? 0));
    return await ctx.db.insert("stripeCheckoutDrafts", {
      items: args.items,
      discountAmount: args.discountAmount,
      total,
      createdBy: args.createdBy,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const attachStripeSessionToDraft = internalMutation({
  args: {
    draftId: v.id("stripeCheckoutDrafts"),
    stripeSessionId: v.string(),
  },
  handler: async (ctx, { draftId, stripeSessionId }) => {
    await ctx.db.patch(draftId, { stripeSessionId });
    return null;
  },
});

export const finalizeStripeCheckoutDraft = internalMutation({
  args: {
    draftId: v.id("stripeCheckoutDrafts"),
    stripeSessionId: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, { draftId, stripeSessionId, stripePaymentIntentId }) => {
    const draft = await ctx.db.get(draftId);
    if (!draft) {
      throw new Error("Brouillon Stripe introuvable.");
    }

    if (draft.status === "completed" && draft.receiptNumber && draft.venteId) {
      return {
        venteId: draft.venteId,
        receiptNumber: draft.receiptNumber,
        total: draft.total,
      };
    }

    if (draft.stripeSessionId && draft.stripeSessionId !== stripeSessionId) {
      throw new Error("Cette session Stripe ne correspond pas au brouillon enregistré.");
    }

    const result = await recordVente(ctx as MutationCtx, {
      items: draft.items,
      discountAmount: draft.discountAmount,
      paymentMethod: "cb",
    });

    await ctx.db.patch(draftId, {
      stripeSessionId,
      stripePaymentIntentId,
      status: "completed",
      venteId: result.venteId,
      receiptNumber: result.receiptNumber,
      completedAt: Date.now(),
    });

    return result;
  },
});
