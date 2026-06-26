import { action, mutation, query, internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { api, internal } from "./_generated/api";
import { accessAllows, requireCrmPermission } from "./lib";

const CATEGORIES = {
  "Maison et Jardin": [
    "Ameublement",
    "Électroménager",
    "Décoration",
    "Bricolage",
    "Vaisselle",
  ],
  Électronique: [
    "Ordinateurs",
    "Téléphones",
    "Tablettes",
    "Photo, audio et vidéo",
    "Accessoires informatique",
  ],
  Loisirs: [
    "Jeux et Jouets",
    "Vélos",
    "CD - Musique",
    "DVD - Films",
    "Instruments de musique",
    "Livres",
  ],
};

const CONDITIONS = ["Neuf", "Très bon état", "Bon état", "État correct", "À rénover"];

// ─── Step 1: vision identification prompt ─────────────────────────────────────
const IDENTIFICATION_PROMPT = `Tu es un inspecteur d'articles de seconde main réputé pour son regard critique et honnête. Tu ne flattes jamais l'état d'un article.

RÈGLES D'ÉTAT — applique-les strictement en regardant CHAQUE détail visible :
- "Neuf" : emballage d'origine intact ou article manifestement jamais utilisé. RARISSIME en recyclerie.
- "Très bon état" : usage léger à peine perceptible, AUCUNE rayure, tache, décoloration ou pièce manquante visible. Réserve cette note aux vrais articles impeccables.
- "Bon état" : usure normale visible (petites rayures, légère décoloration, traces de manipulation). C'est l'état PAR DÉFAUT d'un article d'occasion utilisé.
- "État correct" : défauts clairement visibles (rayures marquées, taches, fissures mineures, pièces abîmées mais fonctionnelles). Donne cette note si TU DOUTES entre bon état et état correct.
- "À rénover" : réparations nécessaires, pièces manquantes, casse visible, inutilisable en l'état.

BIAIS À CORRIGER :
- Un jouet utilisé par un enfant est au MINIMUM "Bon état", souvent "État correct"
- Un vélo d'enfant avec de la terre/poussière visible = "Bon état" ou "État correct"
- Des meubles avec des traces de vie = "Bon état" au mieux
- Si tu vois de la saleté, des rayures ou de l'usure sur la photo → descends d'un cran
- En cas de doute → choisis l'état INFÉRIEUR, jamais supérieur

Analyse cette image et retourne UNIQUEMENT un JSON valide (sans markdown) :
{
  "name": "nom précis de l'objet en français (marque et modèle si visibles, matière, couleur, style)",
  "brand": "marque si identifiable, sinon null",
  "estimatedCondition": "une de : Neuf | Très bon état | Bon état | État correct | À rénover",
  "conditionJustification": "liste des défauts visibles qui justifient cette note (sois précis et honnête)",
  "searchQueries": [
    "requête 1 pour annonces similaires sur leboncoin",
    "requête 2 avec marque/modèle si connu + occasion",
    "requête 3 pour prix neuf"
  ],
  "keyDetails": "détails clés : dimensions estimées, matière, particularités, TOUS les défauts visibles",
  "backgroundPrompt": "In English: a concise product photography background description (max 50 words) for this item. Focus on setting, surfaces, and lighting only — no people, no figures. Match the product's material and style. Example for a wooden chair: 'Warm Scandinavian studio, pale linen backdrop, wood grain floor, soft diffused natural light'. Example for a toy: 'Clean white studio, smooth seamless floor, bright even lighting'. Keep it factual and environment-focused."
}`;

// ─── Step 2: valuation prompt (receives search results) ───────────────────────
const VALUATION_PROMPT = `Tu es un acheteur-revendeur professionnel d'occasion, connu pour être EXIGEANT et réaliste. Tu travailles pour Cycle en Bray, une recyclerie dans l'Oise. Tu n'es pas là pour faire plaisir au donateur — tu es là pour fixer un prix juste qui se vendra vraiment.

On te donne :
- La description et l'état d'un article identifié par analyse visuelle (avec justification de l'état)
- Des résultats de recherche en temps réel sur Leboncoin, eBay France, Vinted et Amazon France

MÉTHODOLOGIE STRICTE :
1. Analyse les prix trouvés : prends la médiane des annonces en état SIMILAIRE (pas les annonces "Neuf" si l'article est usé)
2. Distingue prix NEUF (Amazon, site officiel) du prix OCCASION réel (Leboncoin, Vinted, eBay)
3. Prix recyclerie = 90 % du prix occasion médian constaté (légèrement en dessous du particulier sur Leboncoin)
4. DÉCOTES OBLIGATOIRES selon l'état identifié (par rapport aux annonces Leboncoin en état similaire) :
   - "Bon état" : applique -10 % supplémentaires
   - "État correct" : applique -20 % supplémentaires
   - "À rénover" : applique -35 % — l'article nécessite un investissement
5. DÉCOTES MARCHÉ pour articles à faible demande :
   - Jouets génériques, poupées sans collection : -50 % sur toute référence
   - Mobilier années 90-2000 sans style particulier : -40 %
   - CD, DVD, livres de poche : prix plancher 0,50–1 €
   - Bibelots et déco générique : prix plancher 0,50–3 €
   - Petits électroménagers de marque inconnue : -30 %
6. Arrondis : < 10 € → 0,50 € près | 10–50 € → 1 € près | 50–200 € → 5 € près | > 200 € → 10 € près

FOURCHETTES PLANCHER (minimums absolus en recyclerie) :
- Jouets courants / poupées : 0,50–5 € | Jouets de marque premium (LEGO, Playmobil) : 3–20 €
- Vélo enfant usé : 5–15 € | Vélo enfant bon état marque connue : 15–35 €
- Livres : 0,50–2 € | CD/DVD : 0,50–1 €
- Bibelots/déco générique : 0,50–3 €
- Vêtements : 1–5 € pièce

GARDE-FOUS ANTI-OPTIMISME :
- Un article "Bon état" ne vaut JAMAIS autant qu'un article "Très bon état"
- Un jouet d'enfant utilisé = article usé. Pas d'exception.
- Si tu hésites entre deux prix → prends le PLUS BAS
- La recyclerie est légèrement moins chère que Leboncoin, pas bradée : 10 % en dessous est la cible
- Un article qui traîne invendu est un coût, pas un actif

Retourne UNIQUEMENT un objet JSON valide (sans markdown) :
{
  "title": "Nom précis et honnête en français, max 60 caractères (pas de superlatifs)",
  "category": "Exactement une de : Maison et Jardin | Électronique | Loisirs",
  "subcategory": "Exactement une des sous-catégories disponibles",
  "condition": "Reprend l'état évalué à l'étape 1 — ne l'améliore pas sans raison solide",
  "description": "2–3 phrases objectives : identifie l'objet (marque/modèle, matière, dimensions estimées), décris l'état réel avec les défauts visibles, aucune formulation commerciale excessive",
  "price": <prix de vente recyclerie en euros, applique toutes les décotes>,
  "originalPrice": <prix neuf constaté (Amazon/site officiel), null si vraiment inconnu>,
  "priceRationale": "1 phrase précise : source du prix + calcul (ex: 'Leboncoin médiane 22 €, état correct -20 %, recyclerie -10 % = 16 €')",
  "priceJustification": "2 à 4 phrases expliquant le raisonnement complet : pourquoi cet article vaut ce prix, quels facteurs ont influencé la note d'état, pourquoi la demande est forte ou faible pour cet article, et si applicable ce qui pourrait faire varier le prix (ex: marque, rareté, tendance du marché)",
  "valueColor": "<hex strict : #ef4444 rouge si price/originalPrice < 5 % | #f97316 orange 5–10 % | #eab308 jaune 10–20 % | #84cc16 vert clair 20–30 % | #22c55e vert > 30 % ou article rare très demandé>",
  "valueLabel": "Phrase courte et honnête sur la valeur réelle (ex: 'Faible valeur — article courant usé', 'Valeur correcte pour l'état', 'Bon potentiel de revente', 'Article rare et demandé')",
  "onlineEligible": <true si le prix recommandé est supérieur ou égal à 10 €, sinon false>,
  "recommendedSaleMode": "single" ou "bundle",
  "singleSaleNote": "Note IA courte : explique l'intérêt ou le risque de vendre l'article seul.",
  "bundleSaleNote": "Note IA courte : explique avec quels articles du même univers il pourrait être vendu en lot, et pourquoi.",
  "listingRecommendation": "Phrase opérationnelle en français : recommande clairement soit 'mise en ligne seule', soit 'mise en attente pour lot'. Même si price >= 10, recommande 'bundle' si l'article est plus attractif groupé avec des articles du même univers.",
  "keywords": ["8 à 12 mots-clés précis : marque, licence/univers, personnage, type d'objet, matière, usage. Exemple Mario Kart : mario, nintendo, kart, voiture, circuit, figurine"],
  "themeKey": "clé courte en minuscules pour l'univers exact, pas une catégorie large. Exemples : mario, playmobil-pirates, lego-star-wars, vaisselle-vintage, livres-policiers",
  "sources": ["URLs complètes (https://…) des pages réellement consultées pour fixer le prix : annonces Leboncoin/Vinted/eBay, fiche produit Amazon/site officiel. 2 à 5 liens. Tableau vide si aucune source web."]
}

Sous-catégories :
- Maison et Jardin : Ameublement, Électroménager, Décoration, Bricolage, Vaisselle
- Électronique : Ordinateurs, Téléphones, Tablettes, Photo, audio et vidéo, Accessoires informatique
- Loisirs : Jeux et Jouets, Vélos, CD - Musique, DVD - Films, Instruments de musique, Livres`;

export type ArticleAIAnalysis = {
  title: string;
  category: keyof typeof CATEGORIES;
  subcategory: string;
  condition: (typeof CONDITIONS)[number];
  description: string;
  price: number;
  originalPrice: number | null;
  priceRationale?: string;
  priceJustification?: string;
  valueColor: string;
  valueLabel: string;
  onlineEligible?: boolean;
  recommendedSaleMode?: "single" | "bundle";
  singleSaleNote?: string;
  bundleSaleNote?: string;
  listingRecommendation?: string;
  keywords?: string[];
  themeKey?: string;
  sources?: string[];
  backgroundPrompt?: string;
};

type IdentificationResult = {
  name: string;
  brand: string | null;
  estimatedCondition: string;
  conditionJustification: string;
  searchQueries: string[];
  keyDetails: string;
  backgroundPrompt: string;
};

export type LotAnalysisGroup = {
  title: string;
  reason: string;
  suggestedPrice: number;
  articleIds: string[];
  merchandisingNote?: string;
};

type LotAnalysisResult = {
  groups: LotAnalysisGroup[];
};

async function callOpenAI<T>(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erreur API OpenAI (${response.status}): ${err.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const raw = data.choices?.[0]?.message?.content ?? "";
  let cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();
  // Le modèle ajoute parfois du texte autour du JSON : on isole l'objet { … }.
  if (!cleaned.startsWith("{")) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("Réponse IA non parseable : " + cleaned.slice(0, 150));
  }
}

function fallbackLotAnalysis(
  articles: Array<{
    _id: string;
    title: string;
    description?: string;
    price: number;
    category: string;
    subcategory?: string;
    status: string;
    keywords?: string[];
    themeKey?: string;
  }>,
): LotAnalysisResult {
  const groups = new Map<string, typeof articles>();
  for (const article of articles) {
    const key = article.themeKey || fallbackThemeKey(article);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), article]);
  }

  return {
    groups: Array.from(groups.entries())
      .map(([key, items]) => {
        const sorted = [...items].sort((a, b) => a.price - b.price);
        const total = sorted.reduce((sum, article) => sum + article.price, 0);
        return {
          title: lotTitleFromKey(key, sorted),
          reason:
            "Regroupement automatique par thème précis et mots-clés proches. À valider avant mise en ligne.",
          suggestedPrice: discountedBundlePrice(total),
          articleIds: sorted.map((article) => article._id),
          merchandisingNote: "Lot intéressant si la sélection raconte le même usage client.",
        };
      })
      .filter((group) => group.articleIds.length >= 2)
      .slice(0, 12),
  };
}

function normalizeKeyword(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const THEME_PATTERNS: Array<{ words: string[]; key: string }> = [
  { words: ["mario", "kart", "luigi", "toad", "bowser", "yoshi", "peach", "nintendo"], key: "mario" },
  { words: ["batman", "gotham", "joker", "bruce wayne"], key: "batman" },
  { words: ["superman", "wonder woman", "aquaman", "flash", "dc comics", "justice league"], key: "dc-super-heros" },
  { words: ["ironman", "iron", "avengers", "thor", "hulk", "captain", "america", "marvel", "wakanda", "black panther", "hawkeye", "falcon", "antman", "ant man"], key: "marvel" },
  { words: ["spiderman", "spider"], key: "spider-man" },
  { words: ["buzz", "lightyear", "woody", "jessie", "slinky", "toy story", "lotso", "hamm", "rex"], key: "toy-story" },
  { words: ["playmobil"], key: "playmobil" },
  { words: ["pirate", "pirates", "bateau", "corsaire"], key: "pirates" },
  { words: ["lego"], key: "lego" },
  { words: ["pokemon", "pikachu", "charizard", "bulbasaur", "squirtle", "eevee", "mewtwo"], key: "pokemon" },
  { words: ["barbie", "ken"], key: "barbie" },
  { words: ["star wars", "starwars", "jedi", "sith", "yoda", "darth", "vader", "stormtrooper", "mandalorian", "lightsaber"], key: "star-wars" },
  { words: ["harry potter", "hogwarts", "hermione", "dumbledore", "voldemort", "poudlard", "weasley"], key: "harry-potter" },
  { words: ["minions", "gru", "despicable"], key: "minions" },
  { words: ["frozen", "elsa", "anna", "olaf", "reine des neiges"], key: "frozen" },
  { words: ["cars", "mcqueen", "lightning", "radiator springs"], key: "cars-pixar" },
  { words: ["dinosaure", "dinosaures", "dino", "jurassic"], key: "dinosaures" },
  { words: ["foot", "football", "ballon"], key: "football" },
];

function fallbackThemeKey(article: {
  title: string;
  description?: string;
  keywords?: string[];
}) {
  const text = normalizeKeyword(
    `${article.title} ${article.description ?? ""} ${(article.keywords ?? []).join(" ")}`,
  );
  const words = new Set(text.split(/\s+/).filter(Boolean));
  const fullText = text;

  for (const pattern of THEME_PATTERNS) {
    const matched = pattern.words.some((w) => {
      if (w.includes(" ")) return fullText.includes(w);
      return words.has(w);
    });
    if (matched) return pattern.key;
  }
  return "";
}

function lotTitleFromKey(
  key: string,
  articles: Array<{ keywords?: string[]; subcategory?: string }>,
) {
  const words = key
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  if (words.length > 0) return `Lot univers ${words.join(" ")}`;
  return `Lot ${articles[0]?.subcategory || "sélection"}`;
}

function discountedBundlePrice(total: number) {
  const discountRate = total >= 40 ? 0.82 : 0.85;
  return Math.max(10, Math.round(total * discountRate));
}

function sanitizeLotGroups(
  groups: LotAnalysisGroup[],
  articles: Array<{
    _id: string;
    price: number;
    themeKey?: string;
  }>,
) {
  const articleById = new Map(articles.map((article) => [article._id, article]));
  const used = new Set<string>();
  return groups
    .map((group) => {
      // On garde l'ordre proposé par l'IA mais sans réutiliser un article déjà
      // placé dans un lot précédent (un article ne peut appartenir qu'à un lot).
      const uniqueIds = Array.from(new Set(group.articleIds));
      const groupArticles = uniqueIds
        .map((id) => articleById.get(id))
        .filter((article): article is NonNullable<typeof article> => Boolean(article))
        .filter((article) => !used.has(article._id));
      const total = groupArticles.reduce((sum, article) => sum + article.price, 0);
      // On fait confiance au regroupement sémantique de l'IA : il suffit d'avoir
      // au moins deux articles existants (peu importe le statut ou le thème
      // dérivé). L'équipe valide ensuite avant publication.
      const valid = groupArticles.length >= 2;
      if (valid) for (const article of groupArticles) used.add(article._id);
      return {
        ...group,
        articleIds: groupArticles.map((article) => article._id),
        suggestedPrice: Math.min(
          Math.max(8, Number(group.suggestedPrice) || 10),
          discountedBundlePrice(total),
        ),
        _valid: valid,
      };
    })
    .filter((group) => group._valid)
    .map(({ _valid, ...group }) => group)
    .slice(0, 12);
}

export const analyzePotentialLots = action({
  args: {},
  handler: async (ctx): Promise<LotAnalysisResult> => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, "articles", "analyze")) {
      throw new Error("Accès CRM insuffisant.");
    }

    const articles = await ctx.runQuery(api.articles.listForLotAnalysis, {});
    if (articles.length < 2) return { groups: [] };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return fallbackLotAnalysis(articles);

    try {
      const result = await callOpenAI<LotAnalysisResult>(apiKey, {
        model: "gpt-4o",
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: "system",
            content:
              "Tu es responsable merchandising d'une recyclerie française. Ton objectif est de MAXIMISER le nombre de lots proposés. Regroupe les articles par univers, personnage, licence ou franchise. Sois LARGE dans tes regroupements : tous les superhéros Marvel ensemble, tous les personnages Toy Story ensemble, tous les articles Batman ensemble, etc. Un même personnage en plusieurs tailles = lot parfait. Une même franchise = lot. Retourne uniquement du JSON valide, sans commentaires.",
          },
          {
            role: "user",
            content: `Articles disponibles pour analyse de lots :
${JSON.stringify(
  articles.map((article: (typeof articles)[number]) => ({
    id: article._id,
    title: article.title,
    description: article.description.slice(0, 180),
    price: article.price,
    subcategory: article.subcategory,
    keywords: article.keywords?.slice(0, 8),
    themeKey: article.themeKey,
  })),
  null,
  0,
)}

Retourne ce format JSON exact :
{
  "groups": [
    {
      "title": "Titre vendeur du lot",
      "reason": "Pourquoi ces articles vont bien ensemble",
      "suggestedPrice": 25,
      "articleIds": ["id1", "id2"],
      "merchandisingNote": "Conseil court pour l'équipe"
    }
  ]
}

Règles IMPÉRATIVES :
- Minimum 2 articles, maximum 8 par lot.
- Groupe par univers/franchise/personnage : Batman x2 = lot Batman, Iron Man + Spider-Man = lot Marvel, Buzz Lightyear + Slinky = lot Toy Story.
- Un même personnage en différentes tailles = lot idéal.
- Des personnages de la même franchise (Marvel, DC, Toy Story, Star Wars, Nintendo...) = lot valide.
- NE PAS rejeter un lot parce que les articles sont en statut "disponible". Analyser tous les statuts.
- Nom du lot : court et vendeur ("Lot Batman DC", "Lot super-héros Marvel", "Lot Toy Story Pixar", "Lot univers Mario").
- Prix suggéré : somme des prix × 0.82, minimum 8 €.
- Utilise UNIQUEMENT les IDs fournis dans la liste.
- Si tu ne trouves pas au moins 2 groupes cohérents, force quand même les meilleures combinaisons possibles.`,
          },
        ],
      });
      const sanitized = sanitizeLotGroups(result.groups ?? [], articles);
      return sanitized.length > 0 ? { groups: sanitized } : fallbackLotAnalysis(articles);
    } catch {
      return fallbackLotAnalysis(articles);
    }
  },
});

export const analyzeArticleImage = action({
  args: { storageId: v.id("_storage"), extraDetails: v.optional(v.string()) },
  handler: async (ctx, { storageId, extraDetails }): Promise<ArticleAIAnalysis> => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, "articles", "analyze")) {
      throw new Error("Accès CRM insuffisant.");
    }

    const details = extraDetails?.trim();
    const detailsBlock = details
      ? `\n\nPrécisions fournies par l'équipe (informations fiables qui priment sur la photo, ex. modèle exact, RAM, capacité, année, options) :\n${details}`
      : "";

    const imageUrl = await ctx.storage.getUrl(storageId);
    if (!imageUrl) throw new Error("Image introuvable en stockage.");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      throw new Error(
        "Clé OpenAI non configurée. Exécutez : npx convex env set OPENAI_API_KEY sk-...",
      );

    // ── Étape 1 : identification visuelle ──────────────────────────────────
    const identification = await callOpenAI<IdentificationResult>(apiKey, {
      model: "gpt-4o",
      max_tokens: 400,
      temperature: 0.1,
      messages: [
        { role: "system", content: IDENTIFICATION_PROMPT },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            { type: "text", text: `Identifie cet article.${detailsBlock}` },
          ],
        },
      ],
    });

    // ── Étape 2 : recherche marché + valorisation ──────────────────────────
    // gpt-4o-search-preview peut naviguer sur le web pour trouver des prix réels
    const searchUserPrompt = `Article à évaluer :
- Nom : ${identification.name}${identification.brand ? ` (marque : ${identification.brand})` : ""}
- État : ${identification.estimatedCondition}
- Justification de l'état (défauts constatés) : ${identification.conditionJustification}
- Détails clés : ${identification.keyDetails}

Recherche sur Leboncoin, Vinted, eBay France et Amazon France les prix actuels pour cet article EN ÉTAT SIMILAIRE. Utilise ces requêtes :
1. "${identification.searchQueries[0]}"
2. "${identification.searchQueries[1] ?? identification.searchQueries[0]} occasion prix"
3. "${identification.searchQueries[2] ?? identification.name} prix neuf"

IMPORTANT : applique toutes les décotes selon l'état "${identification.estimatedCondition}" et les défauts constatés. Ne sois pas généreux.${detailsBlock}

Produis l'évaluation JSON complète basée sur les résultats trouvés.`;

    // Étape 2 : on tente d'abord le modèle avec recherche web (prix réels) ;
    // s'il est indisponible (modèle preview retiré, etc.), on retombe sur
    // gpt-4o pour produire l'évaluation à partir des connaissances du modèle.
    let result: ArticleAIAnalysis;
    try {
      result = await callOpenAI<ArticleAIAnalysis>(apiKey, {
        model: "gpt-4o-search-preview",
        max_tokens: 1600,
        web_search_options: { search_context_size: "medium" },
        messages: [
          { role: "system", content: VALUATION_PROMPT },
          { role: "user", content: searchUserPrompt },
        ],
      });
    } catch {
      result = await callOpenAI<ArticleAIAnalysis>(apiKey, {
        model: "gpt-4o",
        max_tokens: 1600,
        temperature: 0.2,
        messages: [
          { role: "system", content: VALUATION_PROMPT },
          { role: "user", content: searchUserPrompt },
        ],
      });
    }

    // Sanity checks
    if (!Object.keys(CATEGORIES).includes(result.category)) {
      result.category = "Maison et Jardin";
    }
    result.price = Math.max(0, Number(result.price) || 0);
    result.originalPrice =
      result.originalPrice != null ? Number(result.originalPrice) || null : null;
    result.onlineEligible = result.price >= 10;
    result.recommendedSaleMode =
      result.recommendedSaleMode === "bundle" || result.price < 10
        ? "bundle"
        : "single";
    if (!result.singleSaleNote) {
      result.singleSaleNote =
        result.price >= 10
          ? "Peut être vendu seul car il atteint le seuil minimum de 10 €."
          : "Vente seule déconseillée car le prix estimé est inférieur au minimum de mise en ligne.";
    }
    if (!result.bundleSaleNote) {
      result.bundleSaleNote =
        result.price >= 10
          ? "Peut aussi servir à renforcer un lot thématique si des articles proches existent."
          : "À conserver pour un lot avec des articles similaires afin d'atteindre un prix vendable.";
    }
    if (!result.listingRecommendation) {
      result.listingRecommendation =
        result.recommendedSaleMode === "single"
          ? "Cet article atteint le seuil minimum de 10 € et peut être mis en ligne seul."
          : "Cet article est plus pertinent en attente pour un lot avec des articles du même univers.";
    }
    result.keywords = Array.from(
      new Set((result.keywords ?? []).map(normalizeKeyword).filter(Boolean)),
    ).slice(0, 12);
    result.sources = Array.from(
      new Set(
        (Array.isArray(result.sources) ? result.sources : [])
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => /^https?:\/\//i.test(s)),
      ),
    ).slice(0, 6);
    result.themeKey =
      result.themeKey?.trim() || fallbackThemeKey({
        title: result.title,
        description: result.description,
        keywords: result.keywords,
      });

    result.backgroundPrompt = identification.backgroundPrompt;

    return result;
  },
});

// ─── Premium background generation via gpt-image-1 ────────────────────────────

function imageFilenameForContentType(contentType: string) {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) {
    return "product.jpg";
  }
  if (contentType.includes("webp")) {
    return "product.webp";
  }
  return "product.png";
}

function sanitizeImageEditPrompt(prompt: string) {
  return prompt
    .replace(
      /\b(skin|nude|body|naked|intimate|sensual|erotic|seductive)\b/gi,
      "",
    )
    .replace(
      /\b(mario|luigi|peach|bowser|nintendo|pokemon|pokémon|disney|marvel|pixar|star wars|harry potter|lego)\b/gi,
      "toy",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

async function editOneImage(
  ctx: ActionCtx,
  apiKey: string,
  storageId: string,
  backgroundPrompt: string,
): Promise<{ storageId: string; url: string }> {
  const imageUrl = await ctx.storage.getUrl(storageId as Id<"_storage">);
  if (!imageUrl) throw new Error(`Image introuvable : ${storageId}`);

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok)
    throw new Error(`Téléchargement image impossible (${imageResponse.status})`);

  const rawBuffer = await imageResponse.arrayBuffer();
  const contentType = imageResponse.headers.get("content-type") ?? "image/png";
  const normalizedContentType = contentType.includes("jpeg")
    ? "image/jpeg"
    : contentType.includes("webp")
      ? "image/webp"
      : "image/png";
  const imageBlob = new Blob([rawBuffer], { type: normalizedContentType });

  const safeBackground =
    sanitizeImageEditPrompt(backgroundPrompt) ||
    "Clean warm neutral product photography studio background, simple surface, soft natural light, subtle shadow.";

  const editPrompt =
    `Edit this product photo for an online second-hand shop. ` +
    `Preserve the item exactly as it appears. Do not recreate, redesign, stylize, or add details to the item. ` +
    `Only replace the surrounding background with: ${safeBackground}. ` +
    `No people, no text, no logos added, clean commercial product photography.`;

  const formData = new FormData();
  formData.append("model", "gpt-image-1");
  formData.append("image", imageBlob, imageFilenameForContentType(normalizedContentType));
  formData.append("prompt", editPrompt);
  formData.append("n", "1");
  formData.append("size", "1024x1024");
  formData.append("quality", "high");

  const editResponse = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!editResponse.ok) {
    const errText = await editResponse.text();
    if (editResponse.status === 400 && errText.includes("moderation_blocked")) {
      throw new Error(
        "OpenAI a bloqué le détourage de cette image. La cause la plus fréquente est un personnage, une marque ou un logo détecté dans la photo. Le prompt a été neutralisé, réessayez maintenant.",
      );
    }
    throw new Error(`OpenAI image edit (${editResponse.status}): ${errText.slice(0, 400)}`);
  }

  const editData = (await editResponse.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message: string; code?: string };
  };

  if (editData.error) {
    if (editData.error.code === "moderation_blocked") {
      throw new Error(
        "OpenAI a bloqué le détourage de cette image. La cause la plus fréquente est un personnage, une marque ou un logo détecté dans la photo. Le prompt a été neutralisé, réessayez maintenant.",
      );
    }
    throw new Error(`OpenAI: ${editData.error.message}`);
  }

  const item = editData.data?.[0];
  if (!item) throw new Error("Aucune image retournée par OpenAI.");

  let processedBlob: Blob;
  if (item.b64_json) {
    const binary = atob(item.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    processedBlob = new Blob([bytes], { type: "image/png" });
  } else if (item.url) {
    const r = await fetch(item.url);
    processedBlob = await r.blob();
  } else {
    throw new Error("Données image absentes dans la réponse OpenAI.");
  }

  const newId = await ctx.storage.store(processedBlob);
  const newUrl = await ctx.storage.getUrl(newId);
  if (!newUrl) throw new Error("URL introuvable après stockage.");

  return { storageId: newId as string, url: newUrl };
}

// ─── Background job pattern (avoids 60s WebSocket timeout) ───────────────────

export const createBgJob = mutation({
  args: {
    storageIds: v.array(v.id("_storage")),
    backgroundPrompt: v.string(),
    articleTitle: v.optional(v.string()),
  },
  handler: async (ctx, { storageIds, backgroundPrompt, articleTitle }) => {
    await requireCrmPermission(ctx, "articles", "analyze");

    const jobId = await ctx.db.insert("bgJobs", {
      status: "pending",
      storageIds,
      backgroundPrompt,
      ...(articleTitle ? { articleTitle } : {}),
    });

    await ctx.scheduler.runAfter(0, internal.ai.processBgJob, { jobId });
    return jobId;
  },
});

export const getBgJob = query({
  args: { jobId: v.id("bgJobs") },
  handler: async (ctx, { jobId }) => {
    await requireCrmPermission(ctx, "articles", "analyze");
    return ctx.db.get(jobId);
  },
});

export const processBgJob = internalAction({
  args: { jobId: v.id("bgJobs") },
  handler: async (ctx, { jobId }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.ai.updateBgJob, {
        jobId,
        status: "error",
        error: "Clé OpenAI non configurée.",
      });
      return;
    }

    const job = await ctx.runQuery(internal.ai.getBgJobInternal, { jobId });
    if (!job) return;

    try {
      const results: Array<{ originalStorageId: Id<"_storage">; newStorageId: Id<"_storage">; url: string }> = [];
      for (const storageId of job.storageIds) {
        const r = await editOneImage(ctx, apiKey, storageId, job.backgroundPrompt);
        results.push({
          originalStorageId: storageId,
          newStorageId: r.storageId as Id<"_storage">,
          url: r.url,
        });
      }
      await ctx.runMutation(internal.ai.updateBgJob, { jobId, status: "done", results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.ai.updateBgJob, { jobId, status: "error", error: msg });
    }
  },
});

export const getBgJobInternal = internalQuery({
  args: { jobId: v.id("bgJobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

export const updateBgJob = internalMutation({
  args: {
    jobId: v.id("bgJobs"),
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("error")),
    results: v.optional(
      v.array(v.object({ originalStorageId: v.id("_storage"), newStorageId: v.id("_storage"), url: v.string() })),
    ),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, status, results, error }) => {
    await ctx.db.patch(jobId, { status, ...(results ? { results } : {}), ...(error ? { error } : {}) });
  },
});
