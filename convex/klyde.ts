import { action, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAnyCrmPermission, requireCrmPermission } from "./lib";

const CONDITIONS = [
  "Neuf avec étiquette",
  "Neuf sans étiquette",
  "Très bon état",
  "Bon état",
  "Satisfaisant",
] as const;

const PARCEL_SIZES = ["Petit", "Moyen", "Grand"] as const;

const CATEGORIES = {
  Vêtements: [
    "Manteaux et vestes",
    "Blousons et bombers",
    "Doudounes et parkas",
    "Trenchs et imperméables",
    "Pulls et gilets",
    "Sweats",
    "Chemises et blouses",
    "T-shirts et tops",
    "Tops et débardeurs",
    "Robes",
    "Combinaisons",
    "Jupes",
    "Pantalons",
    "Jeans",
    "Chinos et toiles",
    "Shorts",
    "Tailleurs et costumes",
    "Ensembles",
    "Joggings et survêtements",
    "Leggings",
    "Sport",
    "Maillots de bain",
    "Sous-vêtements",
    "Lingerie",
    "Pyjamas",
  ],
  Chaussures: [
    "Baskets",
    "Bottes et bottines",
    "Sandales",
    "Tongs et claquettes",
    "Escarpins",
    "Ballerines",
    "Mocassins",
    "Espadrilles",
    "Chaussures de ville",
    "Chaussures de sport",
    "Chaussons",
  ],
  Accessoires: [
    "Sacs",
    "Sacs à dos",
    "Portefeuilles et maroquinerie",
    "Ceintures",
    "Chapeaux et bonnets",
    "Écharpes et foulards",
    "Gants",
    "Bijoux",
    "Montres",
    "Lunettes",
    "Cravates et nœuds papillon",
    "Accessoires cheveux",
  ],
  "Bébé et enfant": [
    "Vêtements de naissance",
    "Bodies",
    "Pyjamas",
    "Hauts",
    "Bas",
    "Robes et ensembles",
    "Manteaux",
    "Sport enfant",
    "Maillots de bain enfant",
    "Sous-vêtements enfant",
    "Chaussures enfant",
    "Accessoires enfant",
  ],
} as const;

const GENDERS = ["Femme", "Homme", "Enfant", "Bébé", "Unisexe"] as const;

const itemStatus = v.union(
  v.literal("stock"),
  v.literal("en_ligne"),
  v.literal("en_cours_envoi"),
  v.literal("envoye"),
  v.literal("gagne"),
  v.literal("archive"),
);

type KlydeAIResult = {
  title: string;
  description: string;
  category: string;
  subcategory?: string | null;
  brand?: string | null;
  size?: string | null;
  condition: string;
  color?: string | null;
  material?: string | null;
  price?: number | null;
  parcelSize?: string | null;
  gender?: string | null;
  style?: string | null;
  aiConfidence?: number | null;
  aiNotes?: string | null;
};

async function requireSignedIn(ctx: {
  auth: {
    getUserIdentity: () => Promise<{
      subject: string;
      email?: string;
      name?: string;
      givenName?: string;
      familyName?: string;
    } | null>;
  };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Connexion requise.");
  return identity;
}

async function withPhotoUrls(
  ctx: { storage: { getUrl: (id: Id<"_storage">) => Promise<string | null> } },
  item: Doc<"klydeItems">,
) {
  const photoUrls = await Promise.all(item.photos.map((id) => ctx.storage.getUrl(id)));
  return { ...item, photoUrls: photoUrls.filter((url): url is string => Boolean(url)) };
}

function cleanOptional(value?: string | null) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizePrice(value?: number | null) {
  if (value == null || Number.isNaN(value)) return undefined;
  return Math.max(0, Math.round(value * 100) / 100);
}

function normalizeQuantity(value?: number) {
  if (!value || Number.isNaN(value) || value < 1) return 1;
  return Math.floor(value);
}

/**
 * Génère une référence interne unique (6 chiffres) pour un article Klyd.
 * Même principe que la réf. interne de la boutique recyclerie : on tire au
 * hasard jusqu'à tomber sur une référence libre (vérifiée via l'index by_sku).
 */
async function generateKlydeReference(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidate = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const existing = await ctx.db
      .query("klydeItems")
      .withIndex("by_sku", (q) => q.eq("sku", candidate))
      .first();
    if (!existing) return candidate;
  }
  throw new Error("Impossible de générer une référence unique.");
}

function sanitizeAnalysis(result: KlydeAIResult): KlydeAIResult {
  const condition = CONDITIONS.includes(result.condition as (typeof CONDITIONS)[number])
    ? result.condition
    : "Bon état";
  const parcelSize = PARCEL_SIZES.includes(result.parcelSize as (typeof PARCEL_SIZES)[number])
    ? result.parcelSize
    : undefined;
  const category = Object.keys(CATEGORIES).includes(result.category)
    ? result.category
    : "Vêtements";
  const subcategories = CATEGORIES[category as keyof typeof CATEGORIES] as readonly string[];
  const subcategory = subcategories.includes(result.subcategory ?? "")
    ? result.subcategory
    : undefined;
  const gender = GENDERS.includes(result.gender as (typeof GENDERS)[number])
    ? result.gender
    : undefined;

  return {
    title: cleanOptional(result.title)?.slice(0, 80) || "Article textile",
    description:
      cleanOptional(result.description)?.slice(0, 1200) ||
      "Article textile d'occasion. Détails à vérifier avant publication.",
    category,
    subcategory,
    brand: cleanOptional(result.brand),
    size: cleanOptional(result.size),
    condition,
    color: cleanOptional(result.color),
    material: cleanOptional(result.material),
    price: normalizePrice(result.price),
    parcelSize,
    gender,
    style: cleanOptional(result.style),
    aiConfidence:
      result.aiConfidence == null ? undefined : Math.max(0, Math.min(1, result.aiConfidence)),
    aiNotes: cleanOptional(result.aiNotes),
  };
}

async function callOpenAI<T>(apiKey: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur OpenAI (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  let cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  if (!cleaned.startsWith("{")) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  }
  return JSON.parse(cleaned) as T;
}

export const list = query({
  args: {
    searchText: v.optional(v.string()),
    status: v.optional(itemStatus),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "klyde:stock", "read");
    const items = args.status
      ? await ctx.db
          .query("klydeItems")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .order("desc")
          .collect()
      : await ctx.db.query("klydeItems").order("desc").collect();

    const search = args.searchText?.trim().toLowerCase();
    const filtered = search
      ? items.filter((item) =>
          [
            item.title,
            item.description,
            item.category,
            item.subcategory,
            item.brand,
            item.size,
            item.color,
            item.material,
            item.sku,
            item.location,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(search),
        )
      : items;

    return Promise.all(filtered.map((item) => withPhotoUrls(ctx, item)));
  },
});

export const listPublic = query({
  args: {
    searchText: v.optional(v.string()),
    category: v.optional(v.string()),
    subcategory: v.optional(v.string()),
    gender: v.optional(v.string()),
    size: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("klydeItems")
      .withIndex("by_status", (q) => q.eq("status", "en_ligne"))
      .order("desc")
      .collect();

    const search = args.searchText?.trim().toLowerCase();
    const nfc = (value?: string | null) => value?.normalize("NFC").trim() ?? "";
    const filtered = items.filter((item) => {
      if (args.category && nfc(item.category) !== nfc(args.category)) return false;
      if (args.subcategory && nfc(item.subcategory) !== nfc(args.subcategory)) return false;
      if (args.gender && item.gender !== args.gender) return false;
      if (args.size && item.size !== args.size) return false;
      if (item.price == null) return false;
      if (!search) return true;
      return [
        item.title,
        item.description,
        item.category,
        item.subcategory,
        item.brand,
        item.size,
        item.color,
        item.material,
        item.gender,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    return Promise.all(filtered.map((item) => withPhotoUrls(ctx, item)));
  },
});

export const getFeatured = query({
  args: {},
  handler: async (ctx) => {
    const featured = await ctx.db
      .query("klydeItems")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .collect();
    const online = featured.find(
      (item) => item.status === "en_ligne" && item.price != null,
    );
    if (!online) return null;
    return await withPhotoUrls(ctx, online);
  },
});

export const getPublic = query({
  args: { id: v.id("klydeItems") },
  handler: async (ctx, { id }) => {
    const item = await ctx.db.get(id);
    if (!item || item.status !== "en_ligne" || item.price == null) return null;
    return await withPhotoUrls(ctx, item);
  },
});

export const getManyPublic = query({
  args: { ids: v.array(v.id("klydeItems")) },
  handler: async (ctx, { ids }) => {
    const uniqueIds = Array.from(new Set(ids)).slice(0, 40);
    const items = await Promise.all(uniqueIds.map((id) => ctx.db.get(id)));
    return Promise.all(
      items
        .filter((item): item is Doc<"klydeItems"> => Boolean(item))
        .map((item) => withPhotoUrls(ctx, item)),
    );
  },
});

export const latestByCategory = query({
  args: { category: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { category, limit }) => {
    const items = await ctx.db
      .query("klydeItems")
      .withIndex("by_status", (q) => q.eq("status", "en_ligne"))
      .order("desc")
      .take(80);
    const filtered = items
      .filter((item) => item.category === category && item.price != null)
      .slice(0, Math.min(limit ?? 4, 8));
    return Promise.all(filtered.map((item) => withPhotoUrls(ctx, item)));
  },
});

export const myWishlistIds = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireSignedIn(ctx);
    const rows = await ctx.db
      .query("klydeWishlists")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .collect();
    return rows.map((row) => row.itemId);
  },
});

export const toggleWishlist = mutation({
  args: { itemId: v.id("klydeItems") },
  handler: async (ctx, { itemId }) => {
    const identity = await requireSignedIn(ctx);
    const item = await ctx.db.get(itemId);
    if (!item || item.status !== "en_ligne") throw new Error("Article indisponible.");

    const existing = await ctx.db
      .query("klydeWishlists")
      .withIndex("by_clerkId_itemId", (q) =>
        q.eq("clerkId", identity.subject).eq("itemId", itemId),
      )
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { saved: false };
    }

    await ctx.db.insert("klydeWishlists", {
      clerkId: identity.subject,
      itemId,
      createdAt: Date.now(),
    });
    return { saved: true };
  },
});

export const submitCartOrder = mutation({
  args: {
    itemIds: v.array(v.id("klydeItems")),
    customer: v.object({
      firstName: v.string(),
      lastName: v.string(),
      email: v.string(),
      phone: v.string(),
    }),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireSignedIn(ctx);
    const uniqueIds = Array.from(new Set(args.itemIds));
    if (uniqueIds.length === 0) throw new Error("Ajoutez au moins un article au panier.");

    const items = await Promise.all(uniqueIds.map((id) => ctx.db.get(id)));
    const available = items.filter(
      (item): item is Doc<"klydeItems"> =>
        item !== null && item.status === "en_ligne" && item.price != null,
    );
    if (available.length !== uniqueIds.length) {
      throw new Error("Un article du panier n'est plus disponible.");
    }

    const total = available.reduce((sum, item) => sum + (item.price ?? 0), 0);
    const now = Date.now();
    const orderId = await ctx.db.insert("klydeOrders", {
      itemIds: available.map((item) => item._id),
      clerkId: identity.subject,
      customer: {
        firstName: args.customer.firstName.trim(),
        lastName: args.customer.lastName.trim(),
        email: args.customer.email.trim().toLowerCase(),
        phone: args.customer.phone.trim(),
      },
      total: Math.round(total * 100) / 100,
      status: "en_attente_paiement",
      paymentMethod: "card",
      note: cleanOptional(args.note),
      createdAt: now,
    });

    await Promise.all(
      available.map((item) =>
        ctx.db.patch(item._id, {
          status: "en_cours_envoi",
          trackingNotes: [
            item.trackingNotes,
            `Commande boutique ${orderId} créée. Paiement carte en attente.`,
          ]
            .filter(Boolean)
            .join("\n"),
          updatedAt: now,
        }),
      ),
    );

    return { orderId, total };
  },
});

export const create = mutation({
  args: {
    photos: v.array(v.id("_storage")),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    subcategory: v.optional(v.string()),
    brand: v.optional(v.string()),
    size: v.optional(v.string()),
    condition: v.string(),
    color: v.optional(v.string()),
    material: v.optional(v.string()),
    price: v.optional(v.number()),
    parcelSize: v.optional(v.string()),
    gender: v.optional(v.string()),
    style: v.optional(v.string()),
    location: v.optional(v.string()),
    sku: v.optional(v.string()),
    vinted: v.optional(v.boolean()),
    outlet: v.optional(v.union(v.literal("klyd"), v.literal("mobifrip"))),
    quantity: v.optional(v.number()),
    aiConfidence: v.optional(v.number()),
    aiNotes: v.optional(v.string()),
    // Publier directement l'annonce sur la boutique à la création.
    publishOnline: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "klyde:stock", "create");
    if (args.photos.length === 0) throw new Error("Ajoutez au moins une photo.");
    // Mise en ligne immédiate : mêmes droits que updateStatus("en_ligne").
    if (args.publishOnline) {
      await requireAnyCrmPermission(ctx, [
        ["klyde:boutique", "manage"],
        ["klyde:stock", "update"],
      ]);
      if (normalizePrice(args.price) == null) {
        throw new Error("Renseignez un prix pour mettre l'article en ligne.");
      }
    }
    const now = Date.now();
    // Référence auto si l'utilisateur n'en a pas saisi.
    const sku = cleanOptional(args.sku) ?? (await generateKlydeReference(ctx));
    return await ctx.db.insert("klydeItems", {
      photos: args.photos,
      title: args.title.trim() || "Article textile",
      description: args.description.trim(),
      category: (args.category.trim() || "Vêtements").normalize("NFC"),
      subcategory: cleanOptional(args.subcategory)?.normalize("NFC"),
      brand: cleanOptional(args.brand),
      size: cleanOptional(args.size),
      condition: args.condition.trim() || "Bon état",
      color: cleanOptional(args.color),
      material: cleanOptional(args.material),
      price: normalizePrice(args.price),
      parcelSize: cleanOptional(args.parcelSize),
      gender: cleanOptional(args.gender),
      style: cleanOptional(args.style),
      location: cleanOptional(args.location),
      sku,
      vinted: args.vinted ? true : undefined,
      outlet: args.outlet,
      quantity: normalizeQuantity(args.quantity),
      status: args.publishOnline ? "en_ligne" : "stock",
      aiConfidence: args.aiConfidence,
      aiNotes: cleanOptional(args.aiNotes),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("klydeItems"),
    status: itemStatus,
  },
  handler: async (ctx, { id, status }) => {
    // Mettre en ligne = publier sur la boutique ; sinon gestion de stock.
    if (status === "en_ligne") {
      await requireAnyCrmPermission(ctx, [
        ["klyde:boutique", "manage"],
        ["klyde:stock", "update"],
      ]);
    } else {
      await requireCrmPermission(ctx, "klyde:stock", "update");
    }
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
  },
});

export const updateTrackingNotes = mutation({
  args: {
    id: v.id("klydeItems"),
    trackingNotes: v.optional(v.string()),
  },
  handler: async (ctx, { id, trackingNotes }) => {
    await requireCrmPermission(ctx, "klyde:stock", "update");
    await ctx.db.patch(id, {
      trackingNotes: cleanOptional(trackingNotes),
      updatedAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("klydeItems"),
    photos: v.array(v.id("_storage")),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    subcategory: v.optional(v.string()),
    brand: v.optional(v.string()),
    size: v.optional(v.string()),
    condition: v.string(),
    color: v.optional(v.string()),
    material: v.optional(v.string()),
    price: v.optional(v.number()),
    parcelSize: v.optional(v.string()),
    gender: v.optional(v.string()),
    style: v.optional(v.string()),
    location: v.optional(v.string()),
    sku: v.optional(v.string()),
    vinted: v.optional(v.boolean()),
    outlet: v.optional(v.union(v.literal("klyd"), v.literal("mobifrip"))),
    quantity: v.optional(v.number()),
    aiConfidence: v.optional(v.number()),
    aiNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, "klyde:stock", "update");
    if (args.photos.length === 0) throw new Error("Ajoutez au moins une photo.");
    // On complète la référence si elle manque encore (articles antérieurs).
    const sku = cleanOptional(args.sku) ?? (await generateKlydeReference(ctx));
    await ctx.db.patch(args.id, {
      photos: args.photos,
      title: args.title.trim() || "Article textile",
      description: args.description.trim(),
      category: (args.category.trim() || "Vêtements").normalize("NFC"),
      subcategory: cleanOptional(args.subcategory)?.normalize("NFC"),
      brand: cleanOptional(args.brand),
      size: cleanOptional(args.size),
      condition: args.condition.trim() || "Bon état",
      color: cleanOptional(args.color),
      material: cleanOptional(args.material),
      price: normalizePrice(args.price),
      parcelSize: cleanOptional(args.parcelSize),
      gender: cleanOptional(args.gender),
      style: cleanOptional(args.style),
      location: cleanOptional(args.location),
      sku,
      vinted: args.vinted ? true : undefined,
      outlet: args.outlet,
      quantity: normalizeQuantity(args.quantity),
      aiConfidence: args.aiConfidence,
      aiNotes: cleanOptional(args.aiNotes),
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("klydeItems") },
  handler: async (ctx, { id }) => {
    await requireCrmPermission(ctx, "klyde:stock", "delete");
    await ctx.db.delete(id);
  },
});

export const setFeatured = mutation({
  args: { id: v.id("klydeItems") },
  handler: async (ctx, { id }) => {
    await requireAnyCrmPermission(ctx, [
      ["klyde:boutique", "manage"],
      ["klyde:stock", "update"],
    ]);
    const target = await ctx.db.get(id);
    if (!target) throw new Error("Article introuvable.");

    const currentlyFeatured = await ctx.db
      .query("klydeItems")
      .withIndex("by_featured", (q) => q.eq("featured", true))
      .collect();

    const now = Date.now();
    // Un seul article peut être mis en avant : on retire les autres.
    for (const item of currentlyFeatured) {
      if (item._id !== id) await ctx.db.patch(item._id, { featured: false, updatedAt: now });
    }
    await ctx.db.patch(id, { featured: !target.featured, updatedAt: now });
    return { featured: !target.featured };
  },
});

export const assertCanAnalyze = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, "klyde:stock", "analyze");
    return true;
  },
});

export const analyzePhotos = action({
  args: {
    storageIds: v.array(v.id("_storage")),
    extraDetails: v.optional(v.string()),
  },
  handler: async (ctx, { storageIds, extraDetails }) => {
    await ctx.runQuery(internal.klyde.assertCanAnalyze, {});
    if (storageIds.length === 0) throw new Error("Aucune photo à analyser.");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("Clé OpenAI absente du déploiement Convex partagé.");
    }

    const urls = await Promise.all(storageIds.slice(0, 8).map((id) => ctx.storage.getUrl(id)));
    const imageUrls = urls.filter((url): url is string => Boolean(url));
    if (imageUrls.length === 0) throw new Error("Photos introuvables dans le stockage Convex.");

    const prompt = `Tu remplis une fiche boutique pour un stock textile français.
Analyse toutes les photos ensemble, y compris étiquettes, défauts, matières, coupe, public cible et type d'article.
Retourne uniquement un JSON valide avec ces champs:
{
  "title": "titre boutique clair, max 80 caractères",
  "description": "description prête à publier, objective, mentionne l'état et les défauts visibles",
  "category": "une de: Vêtements | Chaussures | Accessoires | Bébé et enfant",
  "subcategory": "une sous-catégorie exacte de la catégorie choisie",
  "brand": "marque si visible ou null",
  "size": "taille si visible ou estimée prudemment, sinon null",
  "condition": "une de: Neuf avec étiquette | Neuf sans étiquette | Très bon état | Bon état | Satisfaisant",
  "color": "couleur principale, sinon null",
  "material": "matière si visible/probable, sinon null",
  "price": prix conseillé en euros pour la boutique, nombre ou null,
  "parcelSize": "Petit | Moyen | Grand",
  "gender": "une de: Femme | Homme | Enfant | Bébé | Unisexe",
  "style": "style/mots utiles: vintage, casual, sport, chic... ou null",
  "aiConfidence": nombre entre 0 et 1,
  "aiNotes": "points à vérifier humainement"
}
Sous-catégories autorisées:
- Vêtements: Manteaux et vestes, Blousons et bombers, Doudounes et parkas, Trenchs et imperméables, Pulls et gilets, Sweats, Chemises et blouses, T-shirts et tops, Tops et débardeurs, Robes, Combinaisons, Jupes, Pantalons, Jeans, Chinos et toiles, Shorts, Tailleurs et costumes, Ensembles, Joggings et survêtements, Leggings, Sport, Maillots de bain, Sous-vêtements, Lingerie, Pyjamas
- Chaussures: Baskets, Bottes et bottines, Sandales, Tongs et claquettes, Escarpins, Ballerines, Mocassins, Espadrilles, Chaussures de ville, Chaussures de sport, Chaussons
- Accessoires: Sacs, Sacs à dos, Portefeuilles et maroquinerie, Ceintures, Chapeaux et bonnets, Écharpes et foulards, Gants, Bijoux, Montres, Lunettes, Cravates et nœuds papillon, Accessoires cheveux
- Bébé et enfant: Vêtements de naissance, Bodies, Pyjamas, Hauts, Bas, Robes et ensembles, Manteaux, Sport enfant, Maillots de bain enfant, Sous-vêtements enfant, Chaussures enfant, Accessoires enfant
Sois prudent: si marque, taille ou matière ne sont pas visibles, mets null.
${extraDetails?.trim() ? `Contexte fourni par l'utilisateur: ${extraDetails.trim()}` : ""}`;

    const result = await callOpenAI<KlydeAIResult>(apiKey, {
      model: "gpt-4o",
      temperature: 0.1,
      max_tokens: 1200,
      messages: [
        {
          role: "user",
          content: [
            ...imageUrls.map((url) => ({
              type: "image_url",
              image_url: { url, detail: "high" },
            })),
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    return sanitizeAnalysis(result);
  },
});

/**
 * Lance une prédiction FASHN et attend son résultat (polling), en renvoyant
 * l'URL de l'image générée. Chaque étape « quality » prend ~1 min.
 */
async function runFashnPrediction(
  apiKey: string,
  modelName: string,
  inputs: Record<string, unknown>,
): Promise<string> {
  const runResponse = await fetch("https://api.fashn.ai/v1/run", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model_name: modelName, inputs }),
  });
  if (!runResponse.ok) {
    const errorText = await runResponse.text();
    throw new Error(`Erreur FASHN (${runResponse.status}): ${errorText.slice(0, 300)}`);
  }
  const runData = (await runResponse.json()) as { id?: string; error?: unknown };
  if (runData.error || !runData.id) {
    throw new Error(`FASHN: ${JSON.stringify(runData.error ?? "réponse invalide").slice(0, 300)}`);
  }

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const statusResponse = await fetch(`https://api.fashn.ai/v1/status/${runData.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusResponse.ok) continue;
    const statusData = (await statusResponse.json()) as {
      status?: string;
      output?: string[];
      error?: unknown;
    };
    if (statusData.status === "completed") {
      const output = statusData.output?.[0];
      if (!output) throw new Error("FASHN n'a renvoyé aucune image.");
      return output;
    }
    if (statusData.status === "failed" || statusData.error) {
      throw new Error(
        `Génération FASHN échouée: ${JSON.stringify(statusData.error ?? "inconnue").slice(0, 300)}`,
      );
    }
  }
  throw new Error("Génération FASHN expirée, réessayez.");
}

/**
 * Prompt de « mise en scène » : garde le mannequin et le vêtement principal
 * intacts, puis ajoute des accessoires/pièces complémentaires assortis et un
 * environnement/contexte sur mesure correspondant à l'univers du vêtement.
 */
function buildStylingPrompt(garment?: {
  category?: string;
  subcategory?: string;
  gender?: string;
  style?: string;
  color?: string;
  brand?: string;
}): string {
  const descriptors = [
    cleanOptional(garment?.subcategory) ?? cleanOptional(garment?.category),
    cleanOptional(garment?.style),
    cleanOptional(garment?.color),
    cleanOptional(garment?.brand),
  ].filter(Boolean);
  const garmentDesc = descriptors.length ? ` (${descriptors.join(", ")})` : "";

  return (
    `Keep the same person, face, body, pose and the main worn garment${garmentDesc} exactly the same. ` +
    `Style the look by adding tasteful, complementary fashion accessories and additional clothing pieces ` +
    `(such as shoes, bag, jewelry, layers) that match the garment's style and colours. ` +
    `Replace the background with a bespoke environment and context that fits the garment's universe: ` +
    `choose the setting, location, season, lighting, colours and mood that best tell its story. ` +
    `Be creative and vary the scene (studio, outdoor, urban, nature, stylish interior), ` +
    `keeping it coherent with the style. High-end editorial lookbook / brand e-commerce rendering, photorealistic.`
  );
}

/**
 * Essayage FASHN en deux temps : (1) Try-On Max place l'article sur le
 * mannequin (image) choisi par l'utilisateur — le mannequin est conservé ;
 * (2) un passage `edit` ajoute des accessoires/pièces complémentaires assortis
 * et génère un environnement/contexte sur mesure. Un seed aléatoire varie la
 * mise en scène à chaque fois. L'image finale est stockée dans Convex.
 */
export const generateTryOn = action({
  args: {
    storageId: v.id("_storage"),
    // Image du mannequin choisi (asset public de l'app Klyd), URL absolue.
    modelImageUrl: v.string(),
    // Qualité/résolution de sortie FASHN (défaut: 2k).
    resolution: v.optional(v.union(v.literal("1k"), v.literal("2k"), v.literal("4k"))),
    // Attributs de l'article pour orienter accessoires et contexte générés.
    garment: v.optional(
      v.object({
        category: v.optional(v.string()),
        subcategory: v.optional(v.string()),
        gender: v.optional(v.string()),
        style: v.optional(v.string()),
        color: v.optional(v.string()),
        brand: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { storageId, modelImageUrl, resolution, garment }) => {
    await ctx.runQuery(internal.klyde.assertCanAnalyze, {});

    const apiKey = process.env.FASHN_API_KEY;
    if (!apiKey) {
      throw new Error("Clé FASHN absente du déploiement Convex partagé.");
    }
    if (!/^https?:\/\//i.test(modelImageUrl)) {
      throw new Error("Image du mannequin invalide.");
    }
    const outputResolution = resolution ?? "2k";

    const productUrl = await ctx.storage.getUrl(storageId);
    if (!productUrl) throw new Error("Photo introuvable dans le stockage Convex.");

    // 1) Try-On Max : l'article porté par le mannequin choisi (mannequin conservé).
    const tryOnUrl = await runFashnPrediction(apiKey, "tryon-max", {
      product_image: productUrl,
      model_image: modelImageUrl,
      resolution: outputResolution,
      generation_mode: "quality",
      output_format: "png",
      num_images: 1,
    });

    // 2) Mise en scène : accessoires/pièces complémentaires + contexte sur mesure.
    const resultUrl = await runFashnPrediction(apiKey, "edit", {
      image: tryOnUrl,
      prompt: buildStylingPrompt(garment),
      resolution: outputResolution,
      generation_mode: "quality",
      output_format: "png",
      num_images: 1,
      // Seed aléatoire : une mise en scène différente à chaque génération.
      seed: Math.floor(Math.random() * 2_147_483_647),
    });

    // 3) Téléchargement et stockage de l'image générée dans Convex.
    const imageResponse = await fetch(resultUrl);
    if (!imageResponse.ok) throw new Error("Image générée par FASHN inaccessible.");
    const blob = await imageResponse.blob();
    const newStorageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(newStorageId);
    return { storageId: newStorageId, url };
  },
});
