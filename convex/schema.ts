import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** Type de demande géré par la recyclerie. */
export const requestType = v.union(
  v.literal("aerogommage"),
  v.literal("collecte"),
  v.literal("article"),
  v.literal("velo"),
  v.literal("livraison"),
);

/** App « Bennes & Pro » — matériaux déposables. */
export const bpMaterial = v.union(
  v.literal("Réemploi"),
  v.literal("Bois"),
  v.literal("CSR"),
  v.literal("Inertes/Gravats"),
  v.literal("Laine de roche"),
  v.literal("Laine de verre"),
  v.literal("Menuiseries Vitrées"),
  v.literal("Métaux"),
  v.literal("Plastiques d'emballages et cartons"),
  v.literal("Plastiques rigide"),
  v.literal("Plâtres"),
  v.literal("Tout venant/DIB non triés"),
);

/** App « Bennes & Pro » — unités de mesure. */
export const bpUnit = v.union(
  v.literal("kg"),
  v.literal("m3"),
  v.literal("tonne"),
  v.literal("unite"),
);

/** App « Bennes & Pro » — facturation Stripe du DIB d'un dépôt. */
export const bpBilling = v.object({
  /** Poids DIB facturable en kg (lignes kg + tonnes converties). */
  weightKg: v.number(),
  /** Prix appliqué, en centimes d'euro par kg (HT). */
  priceCentsPerKg: v.number(),
  /** Montant HT en centimes d'euro (la TVA est ajoutée sur la facture Stripe). */
  amountCents: v.number(),
  /** Taux de TVA appliqué (ex. 20). Les anciens dépôts sans valeur sont affichés au taux courant. */
  vatRate: v.optional(v.number()),
  status: v.union(
    v.literal("pending"),
    v.literal("invoiced"),
    v.literal("error"),
  ),
  stripeInvoiceId: v.optional(v.string()),
  stripeInvoiceUrl: v.optional(v.string()),
  /** Statut de règlement Stripe (open = en attente, paid = payée…). */
  paymentStatus: v.optional(
    v.union(
      v.literal("open"),
      v.literal("paid"),
      v.literal("draft"),
      v.literal("void"),
      v.literal("uncollectible"),
    ),
  ),
  paidAt: v.optional(v.number()),
  error: v.optional(v.string()),
  invoicedAt: v.optional(v.number()),
});

/** Étape du pipeline (uniquement pour les demandes ouvertes). */
export const requestStage = v.union(
  v.literal("nouveau"),
  v.literal("validation"),
  v.literal("planifie"),
);

/** Sous-type de collecte (défini dans le CRM après réception). */
export const collecteType = v.union(
  v.literal("indefini"),
  v.literal("C1"),
  v.literal("C2"),
  v.literal("C3"),
);

/** Résultat d'une demande. `open` = encore dans le pipeline. */
export const requestOutcome = v.union(
  v.literal("open"),
  v.literal("gagnee"),
  v.literal("perdue"),
);

export const requestLostReason = v.union(
  v.literal("devis_refuse"),
  v.literal("pas_de_retour_client"),
  v.literal("autre"),
);

export const requestOrigin = v.union(
  v.literal("internal"),
  v.literal("external"),
);

const customer = v.object({
  firstName: v.string(),
  lastName: v.string(),
  email: v.string(),
  phone: v.string(),
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
});

/** Un objet à aérogommer (une demande peut en contenir plusieurs). */
export const aerogommageItem = v.object({
  objectType: v.optional(v.string()),
  label: v.optional(v.string()), // précision si « Autre »
  height: v.optional(v.number()),
  width: v.optional(v.number()),
  depth: v.optional(v.number()),
  quantity: v.optional(v.number()),
  woodType: v.optional(v.string()),
  stripping: v.optional(v.string()),
  coating: v.optional(v.string()),
  coatingOther: v.optional(v.string()), // précision si « Autre »
  delivery: v.optional(v.boolean()),
  retrieval: v.optional(v.boolean()),
  comment: v.optional(v.string()),
  // Photos rattachées à cet objet précis.
  photos: v.optional(v.array(v.id("_storage"))),
});

const address = v.object({
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
});

const aerogommageOptions = v.object({
  pickupAtHome: v.optional(v.boolean()),
  deliveryAtHome: v.optional(v.boolean()),
  pickupAddress: v.optional(address),
  deliveryAddress: v.optional(address),
});

const collecteDetails = v.object({
  // Forfaits / conditions (Oui/Non).
  dismountable: v.optional(v.boolean()),
  reusableGoodCondition: v.optional(v.boolean()),
  sorted: v.optional(v.boolean()),
  noWaste: v.optional(v.boolean()),
  // Catégories d'objets sélectionnées (pictogrammes). Clés de COLLECTE_CATEGORIES.
  objectCategories: v.optional(v.array(v.string())),
  // Photos rattachées à chaque catégorie sélectionnée.
  categoryPhotos: v.optional(
    v.array(
      v.object({
        category: v.string(),
        photos: v.array(v.id("_storage")),
      }),
    ),
  ),
  // Champs hérités (multi-sélection par famille, anciennes demandes).
  grosObjets: v.optional(v.array(v.string())),
  grosObjetsAutre: v.optional(v.string()),
  petitsObjets: v.optional(v.array(v.string())),
  petitsObjetsAutre: v.optional(v.string()),
  // Logement.
  housingType: v.optional(v.string()),
  floors: v.optional(v.number()),
  // Stationnement.
  dedicatedParking: v.optional(v.boolean()),
  parkingDistance: v.optional(v.number()),
  parkingUnknown: v.optional(v.boolean()),
  // Champs hérités (anciennes demandes).
  parkingNearby: v.optional(v.boolean()),
  largeItems: v.optional(v.string()),
  furniture: v.optional(v.string()),
  smallItems: v.optional(v.string()),
  // L'adresse de collecte peut différer de l'adresse de facturation (client).
  collectAddress: v.optional(address),
});

const articleDetails = v.object({
  articleId: v.id("articles"),
  articleTitle: v.string(),
});

const reservedArticleDetails = v.object({
  articleId: v.id("articles"),
  articleTitle: v.string(),
});

const requestPayment = v.object({
  method: v.union(v.literal("cb"), v.literal("especes")),
  status: v.union(v.literal("pending"), v.literal("paid")),
  validated: v.boolean(),
  captured: v.boolean(),
  provider: v.optional(v.literal("stripe")),
  stripeSessionId: v.optional(v.string()),
  stripePaymentIntentId: v.optional(v.string()),
  paidAt: v.optional(v.number()),
});

const veloDetails = v.object({
  bikeType: v.optional(v.string()),
  service: v.optional(v.string()),
  brand: v.optional(v.string()),
  condition: v.optional(v.string()),
  description: v.optional(v.string()),
});

/** Demande de livraison d'un article (créée depuis le CRM). */
const livraisonDetails = v.object({
  // Adresse de livraison (peut être identique à l'adresse de facturation).
  deliveryAddress: v.optional(address),
  sameAsBilling: v.optional(v.boolean()),
  // Photo de l'article (catégorisation IA) et photo de la référence / code-barres.
  articlePhoto: v.optional(v.id("_storage")),
  referencePhoto: v.optional(v.id("_storage")),
  // Résultats de l'analyse IA de la photo article.
  articleTitle: v.optional(v.string()),
  category: v.optional(v.string()),
  subcategory: v.optional(v.string()),
  condition: v.optional(v.string()),
  // Référence interne de l'article : reprise du code-barres scanné si présent,
  // sinon générée automatiquement.
  reference: v.optional(v.string()),
  referenceFromBarcode: v.optional(v.boolean()),
  // Prix de l'article (issu du code-barres scanné) et acompte de 20 %.
  articlePrice: v.optional(v.number()),
  acompte: v.optional(v.number()),
  // Calcul des frais de livraison (Mapbox : dépôt → adresse de livraison).
  distanceKm: v.optional(v.number()),
  deliveryFee: v.optional(v.number()),
  // Créneau avantageux retenu (livraison groupée avec une collecte proche).
  suggestedSlot: v.optional(
    v.object({
      requestReference: v.optional(v.string()),
      scheduledDate: v.optional(v.number()),
      distanceKm: v.optional(v.number()),
      city: v.optional(v.string()),
      discount: v.optional(v.number()),
      // Frais réduits : 1 €/km entre l'adresse de collecte et le client.
      reducedDeliveryFee: v.optional(v.number()),
    }),
  ),
});

export default defineSchema(
  {
  articles: defineTable({
    title: v.string(),
    description: v.string(),
    price: v.number(),
    weightKg: v.optional(v.number()),
    // Emplacement physique de l'article en boutique / réserve.
    location: v.optional(v.string()),
    originalPrice: v.optional(v.number()),
    internalReference: v.optional(v.string()),
    gdrReference: v.optional(v.string()),
    category: v.string(),
    subcategory: v.optional(v.string()),
    condition: v.string(),
    keywords: v.optional(v.array(v.string())),
    themeKey: v.optional(v.string()),
    images: v.array(v.id("_storage")),
    status: v.union(
      v.literal("disponible"),
      v.literal("reserve"),
      v.literal("vendu"),
      v.literal("attente"),
      // Ancien statut conservé pour compatibilité avec les articles déjà créés.
      v.literal("lot"),
    ),
    isLot: v.optional(v.boolean()),
    bundledArticleIds: v.optional(v.array(v.id("articles"))),
    bundleKey: v.optional(v.string()),
    bundleReason: v.optional(v.string()),
    // Article mis en avant "Produit du jour" (un seul à la fois).
    productOfDay: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_internalReference", ["internalReference"])
    .index("by_gdrReference", ["gdrReference"])
    .index("by_productOfDay", ["productOfDay"]),

  /** Articles sauvegardés (wishlist) par les clients connectés. */
  wishlists: defineTable({
    userId: v.string(),
    articleId: v.id("articles"),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_article", ["userId", "articleId"])
    .index("by_article", ["articleId"]),

  requests: defineTable({
    type: requestType,
    stage: requestStage,
    outcome: requestOutcome,
    lostReason: v.optional(requestLostReason),
    lostReasonDetails: v.optional(v.string()),
    requestOrigin: v.optional(requestOrigin),
    complete: v.boolean(),
    // Process séquentiel : liste ordonnée des étapes + nombre d'étapes cochées.
    processSteps: v.array(v.string()),
    completedSteps: v.number(),
    // Journal : qui a coché chaque étape et quand.
    processLog: v.optional(
      v.array(
        v.object({ step: v.number(), by: v.string(), at: v.number() }),
      ),
    ),
    processNotes: v.optional(
      v.array(
        v.object({
          step: v.number(),
          by: v.string(),
          at: v.number(),
          body: v.string(),
        }),
      ),
    ),
    collecteType: v.optional(collecteType),
    // Dernier modificateur par champ (clé = nom du champ) — affiché « Modifié
    // par … » sous chaque champ du CRM. `by` = persona ou nom du compte.
    fieldEdits: v.optional(
      v.record(v.string(), v.object({ by: v.string(), at: v.number() })),
    ),
    // --- Gestion interne (onglet Gestion du CRM) ---
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    assignedTo: v.optional(v.id("teamMembers")),
    estimatedHours: v.optional(v.number()),
    actualHours: v.optional(v.number()),
    quoteAmount: v.optional(v.number()),
    quoteDetails: v.optional(v.string()),
    scheduledDate: v.optional(v.number()),
    customer,
    // Compte client Clerk rattaché (subject = clerkId), si la demande a été
    // créée par un utilisateur connecté ou liée a posteriori via son email.
    userId: v.optional(v.string()),
    comment: v.optional(v.string()),
    photos: v.array(v.id("_storage")),
    beforePhotos: v.optional(v.array(v.id("_storage"))),
    afterPhotos: v.optional(v.array(v.id("_storage"))),
    aerogommage: v.optional(v.array(aerogommageItem)),
    aerogommageOptions: v.optional(aerogommageOptions),
    collecte: v.optional(collecteDetails),
    article: v.optional(articleDetails),
    articles: v.optional(v.array(reservedArticleDetails)),
    payment: v.optional(requestPayment),
    velo: v.optional(veloDetails),
    livraison: v.optional(livraisonDetails),
    // Véhicule de la flotte affecté (collecte / livraison planifiée).
    assignedVehicle: v.optional(v.id("vehicles")),
    createdAt: v.number(),
    updatedAt: v.number(),
    reference: v.optional(v.string()),
    visitNeeded: v.optional(v.boolean()),
  })
    .index("by_type", ["type"])
    .index("by_outcome", ["outcome"])
    .index("by_userId", ["userId"])
    .index("by_scheduledDate", ["scheduledDate"])
    .index("by_assignedVehicle", ["assignedVehicle"]),

  /** Flotte : véhicules utilitaires de la recyclerie. */
  vehicles: defineTable({
    name: v.string(),
    plate: v.optional(v.string()),
    kind: v.union(
      v.literal("utilitaire"),
      v.literal("voiture"),
    ),
    photo: v.optional(v.id("_storage")),
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    active: v.boolean(),
    recycappEnabled: v.optional(v.boolean()),
    sourceKey: v.optional(v.string()),
    model: v.optional(v.string()),
    statusLabel: v.optional(v.string()),
    vehicleFamily: v.optional(v.string()),
    vehicleSubfamily: v.optional(v.string()),
    siteLabel: v.optional(v.string()),
    seats: v.optional(v.number()),
    reservablePro: v.optional(v.boolean()),
    reservablePersonal: v.optional(v.boolean()),
    structure: v.optional(v.string()),
    acronym: v.optional(v.string()),
    brand: v.optional(v.string()),
    monthlyCost: v.optional(v.number()),
    insuranceCompany: v.optional(v.string()),
    insurancePolicy: v.optional(v.string()),
    odometerKm: v.optional(v.number()),
    odometerUpdatedAt: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    saleDate: v.optional(v.string()),
    allocation: v.optional(v.string()),
    year: v.optional(v.number()),
    assignedTo: v.optional(v.string()),
    technicalControlDate: v.optional(v.string()),
    pollutionControlDate: v.optional(v.string()),
    sourceCreatedAt: v.optional(v.string()),
    photoUrl: v.optional(v.string()),
    documentationUrl: v.optional(v.string()),
    // Champs hérités (conservés pour compatibilité des anciens véhicules).
    capacityM3: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_active", ["active"]),

  /** Comptes clients (boutique). Le clerkId est le `subject` de l'identité Clerk. */
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    // Photo de profil Clerk (URL publique), pour l'afficher dans les emails.
    imageUrl: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    postalCode: v.optional(v.string()),
    city: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_email", ["email"]),

  /** Messagerie client ⇄ administrateurs, rattachée à une demande. */
  messages: defineTable({
    requestId: v.id("requests"),
    senderRole: v.union(v.literal("client"), v.literal("staff")),
    senderName: v.string(),
    senderClerkId: v.optional(v.string()),
    body: v.string(),
    createdAt: v.number(),
    // Accusés de lecture ("Lu à HH:MM").
    readByClientAt: v.optional(v.number()),
    readByStaffAt: v.optional(v.number()),
  })
    .index("by_requestId", ["requestId"])
    .index("by_createdAt", ["createdAt"]),

  notifications: defineTable({
    kind: v.union(v.literal("new_request"), v.literal("new_message")),
    title: v.string(),
    requestId: v.id("requests"),
    requestType,
    customerName: v.string(),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_read_and_createdAt", ["read", "createdAt"])
    .index("by_createdAt", ["createdAt"]),

  teamMembers: defineTable({
    name: v.string(),
    role: v.optional(v.string()),
    email: v.optional(v.string()),
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    active: v.boolean(),
    createdAt: v.number(),
  }),

  /** Droits CRM fins par email staff. Les admins Clerk gardent toujours tous les accès. */
  crmPermissions: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    active: v.boolean(),
    role: v.optional(v.union(v.literal("client"), v.literal("staff"), v.literal("admin"))),
    grants: v.array(
      v.object({
        pageKey: v.string(),
        actions: v.array(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  }).index("by_email", ["email"]),

  bgJobs: defineTable({
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("error")),
    storageIds: v.array(v.id("_storage")),
    backgroundPrompt: v.string(),
    articleTitle: v.optional(v.string()),
    results: v.optional(
      v.array(v.object({ originalStorageId: v.id("_storage"), newStorageId: v.id("_storage"), url: v.string() })),
    ),
    error: v.optional(v.string()),
  }),

  articleViews: defineTable({
    articleId: v.id("articles"),
    sessionId: v.string(),
    lastSeenAt: v.number(),
  })
    .index("by_articleId", ["articleId"])
    .index("by_sessionId", ["sessionId"])
    .index("by_lastSeenAt", ["lastSeenAt"]),

  /** Documents rattachés à une demande (devis, facture…), côté client + CRM. */
  requestDocuments: defineTable({
    requestId: v.id("requests"),
    storageId: v.id("_storage"),
    name: v.string(),
    docType: v.union(
      v.literal("devis"),
      v.literal("facture"),
      v.literal("bon_commande"),
      v.literal("bon_collecte"),
      v.literal("contrat"),
      v.literal("photo"),
      v.literal("autre"),
    ),
    mimeType: v.optional(v.string()),
    uploadedByRole: v.union(v.literal("client"), v.literal("staff")),
    // Si le document provient du gestionnaire (partage) : on référence le
    // fichier source sans dupliquer le blob, et on ne le supprime pas au retrait.
    sourceDocumentId: v.optional(v.id("documents")),
    createdAt: v.number(),
  }).index("by_requestId", ["requestId"]),

  /** Arborescence de dossiers du gestionnaire de documents (CRM). */
  documentFolders: defineTable({
    name: v.string(),
    parentId: v.optional(v.id("documentFolders")),
    createdAt: v.number(),
  }).index("by_parent", ["parentId"]),

  /** Fichiers du gestionnaire de documents (CRM). */
  documents: defineTable({
    name: v.string(),
    folderId: v.optional(v.id("documentFolders")),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
    size: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_folder", ["folderId"]),

  /** Sessions d'arrivage (GDR Collecte). */
  arrivages: defineTable({
    date: v.number(),
    origin: v.union(
      v.literal("decheterie"),
      v.literal("domicile"),
      v.literal("apport"),
      v.literal("tournee"),
    ),
    commune: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("closed")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_date", ["date"]),

  /** Dépôts scellés en attente d'éclatement. */
  depots: defineTable({
    depotNumber: v.number(),
    date: v.number(),
    origin: v.union(
      v.literal("decheterie"),
      v.literal("domicile"),
      v.literal("apport"),
      v.literal("tournee"),
    ),
    commune: v.optional(v.string()),
    weightKg: v.optional(v.number()),
    defaultCategory: v.optional(v.string()),
    defaultSubcategory: v.optional(v.string()),
    defaultFlux: v.optional(v.string()),
    defaultOrientation: v.optional(v.string()),
    note: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("partial"),
      v.literal("closed"),
    ),
    closedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_date", ["date"]),

  /** Articles enregistrés lors d'un arrivage ou d'un éclatement de dépôt. */
  arrivageItems: defineTable({
    arrivageId: v.optional(v.id("arrivages")),
    depotId: v.optional(v.id("depots")),
    date: v.number(),
    origin: v.union(
      v.literal("decheterie"),
      v.literal("domicile"),
      v.literal("apport"),
      v.literal("tournee"),
    ),
    commune: v.optional(v.string()),
    category: v.string(),
    subcategory: v.optional(v.string()),
    flux: v.optional(v.string()),
    orientation: v.string(),
    weightKg: v.optional(v.number()),
    tare: v.optional(v.number()),
    quantity: v.number(),
    price: v.optional(v.number()),
    condition: v.optional(v.string()),
    labelInfo: v.optional(v.string()),
    reference: v.string(),
    articleId: v.optional(v.id("articles")),
    createdAt: v.number(),
    // Sortie de stock : motif + date quand l'article quitte la recyclerie.
    exitedAt: v.optional(v.number()),
    exitMotif: v.optional(v.string()),
  })
    .index("by_arrivage", ["arrivageId"])
    .index("by_depot", ["depotId"])
    .index("by_reference", ["reference"])
    .index("by_date", ["date"]),

  /** GDR Ateliers — suivi de valorisation article par article. */
  atelierSessions: defineTable({
    articleId: v.id("articles"),
    articleReference: v.string(),
    date: v.number(),
    durationMinutes: v.optional(v.number()),
    technicianId: v.optional(v.id("teamMembers")),
    type: v.string(), // nettoyage | reparation | test | reconditionnement | autre
    notes: v.optional(v.string()),
    status: v.union(v.literal("en_cours"), v.literal("termine")),
    createdAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_status", ["status"])
    .index("by_date", ["date"]),

  /** GDR Magasin — ventes enregistrées à la caisse. */
  ventes: defineTable({
    date: v.number(),
    receiptNumber: v.string(),
    items: v.array(v.object({
      articleId: v.id("articles"),
      title: v.string(),
      price: v.number(),
    })),
    subtotal: v.number(),
    discountAmount: v.optional(v.number()),
    total: v.number(),
    paymentMethod: v.union(
      v.literal("especes"),
      v.literal("cb"),
      v.literal("cheque"),
      v.literal("cheque_cadeau"),
      v.literal("virement"),
    ),
    amountTendered: v.optional(v.number()),
    change: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_date", ["date"]),

  stripeCheckoutDrafts: defineTable({
    items: v.array(v.object({
      articleId: v.id("articles"),
      title: v.string(),
      price: v.number(),
    })),
    discountAmount: v.optional(v.number()),
    total: v.number(),
    createdBy: v.string(),
    stripeSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("completed")),
    venteId: v.optional(v.id("ventes")),
    receiptNumber: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_stripeSessionId", ["stripeSessionId"]),

  publicStripeCheckoutDrafts: defineTable({
    articleIds: v.array(v.id("articles")),
    customer: customer,
    comment: v.optional(v.string()),
    total: v.number(),
    stripeSessionId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("completed")),
    requestId: v.optional(v.id("requests")),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_stripeSessionId", ["stripeSessionId"]),

  /** GDR Sorties hors magasin — ventes en dehors de la boutique physique. */
  sortiesHorsMagasin: defineTable({
    date: v.number(),
    articleId: v.optional(v.id("articles")),
    articleTitle: v.string(),
    articleReference: v.optional(v.string()),
    price: v.number(),
    channel: v.union(
      v.literal("leboncoin"),
      v.literal("ebay"),
      v.literal("vinted"),
      v.literal("instagram"),
      v.literal("facebook"),
      v.literal("depot_vente"),
      v.literal("commande"),
      v.literal("autre"),
    ),
    buyerName: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_date", ["date"]),

  /** GDR Sorties matières — flux de matières non réemployables. */
  sortiesMatieres: defineTable({
    date: v.number(),
    materialType: v.string(),
    weightKg: v.number(),
    destination: v.string(),
    documentNumber: v.optional(v.string()),
    notes: v.optional(v.string()),
    origin: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_date", ["date"]),

  /** GDR Tournées — planification des collectes. */
  tournees: defineTable({
    date: v.number(),
    label: v.string(),
    vehicleId: v.optional(v.id("teamMembers")),
    // Véhicule de la flotte affecté à la tournée.
    fleetVehicleId: v.optional(v.id("vehicles")),
    driverId: v.optional(v.id("teamMembers")),
    stops: v.array(v.object({
      requestId: v.optional(v.id("requests")),
      address: v.string(),
      latitude: v.optional(v.number()),
      longitude: v.optional(v.number()),
      contactName: v.optional(v.string()),
      contactPhone: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.union(v.literal("prevu"), v.literal("effectue"), v.literal("annule")),
      order: v.number(),
    })),
    status: v.union(v.literal("planifiee"), v.literal("en_cours"), v.literal("terminee"), v.literal("annulee")),
    notes: v.optional(v.string()),
    depotAddress: v.optional(v.string()),
    depotLatitude: v.optional(v.number()),
    depotLongitude: v.optional(v.number()),
    optimizedAt: v.optional(v.number()),
    estimatedDistanceMeters: v.optional(v.number()),
    estimatedDurationSeconds: v.optional(v.number()),
    routeCoordinates: v.optional(v.array(v.array(v.number()))),
    createdAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_fleetVehicle", ["fleetVehicleId"]),

  tourneeTrackingLinks: defineTable({
    tourneeId: v.id("tournees"),
    shareToken: v.string(),
    stopOrder: v.number(),
    requestId: v.optional(v.id("requests")),
    contactName: v.optional(v.string()),
    address: v.string(),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tourneeId", ["tourneeId"])
    .index("by_requestId", ["requestId"])
    .index("by_shareToken", ["shareToken"]),

  tourneeVehicleLocations: defineTable({
    tourneeId: v.id("tournees"),
    latitude: v.number(),
    longitude: v.number(),
    heading: v.optional(v.number()),
    accuracy: v.optional(v.number()),
    speedKmh: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_tourneeId", ["tourneeId"]),

  /* ─── App « Mes Outils » : portail d'entreprise ──────────────────────────── */

  /** Fil d'actualité interne (style réseau social). */
  posts: defineTable({
    authorClerkId: v.string(),
    authorName: v.string(),
    authorImageUrl: v.optional(v.string()),
    body: v.string(),
    images: v.array(v.id("_storage")),
    videos: v.optional(v.array(v.id("_storage"))),
    pinned: v.optional(v.boolean()),
    createdAt: v.number(),
    editedAt: v.optional(v.number()),
  }).index("by_createdAt", ["createdAt"]),

  postComments: defineTable({
    postId: v.id("posts"),
    authorClerkId: v.string(),
    authorName: v.string(),
    authorImageUrl: v.optional(v.string()),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_postId", ["postId"]),

  postLikes: defineTable({
    postId: v.id("posts"),
    clerkId: v.string(),
    actorName: v.optional(v.string()),
    actorImageUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_postId", ["postId"])
    .index("by_post_and_user", ["postId", "clerkId"]),

  mesoutilsNotifications: defineTable({
    recipientClerkId: v.string(),
    kind: v.union(
      v.literal("room_reservation_confirmed"),
      v.literal("vehicle_reservation_decided"),
      v.literal("new_direct_message"),
      v.literal("post_liked"),
      v.literal("post_commented"),
      v.literal("deal_interest"),
      v.literal("vehicle_reservation_request"),
    ),
    title: v.string(),
    body: v.optional(v.string()),
    actorName: v.optional(v.string()),
    // Photo de profil de l'acteur (message, like, commentaire, intérêt).
    actorImageUrl: v.optional(v.string()),
    // Photo de la salle / du véhicule concerné (notifications de réservation).
    assetImageUrl: v.optional(v.string()),
    href: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_recipient_createdAt", ["recipientClerkId", "createdAt"])
    .index("by_recipient_read_createdAt", ["recipientClerkId", "read", "createdAt"]),

  /** Salles réservables (réservation immédiate si le créneau est libre). */
  rooms: defineTable({
    name: v.string(),
    site: v.optional(v.union(v.literal("60"), v.literal("76"))),
    capacity: v.optional(v.number()),
    color: v.optional(v.string()),
    sourceKey: v.optional(v.string()),
    photo: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    siteLabel: v.optional(v.string()),
    buildingLabel: v.optional(v.string()),
    reservationSummaryRaw: v.optional(v.string()),
    services: v.optional(v.array(v.string())),
    slotsCount: v.optional(v.number()),
    reservable: v.optional(v.boolean()),
    unavailabilityNotes: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
  }).index("by_active", ["active"]),

  roomReservations: defineTable({
    roomId: v.id("rooms"),
    clerkId: v.string(),
    userName: v.string(),
    bookedByName: v.optional(v.string()),
    bookedForClerkId: v.optional(v.string()),
    title: v.string(),
    // Type d'usage de la salle (réunion, atelier, formation…).
    usageType: v.optional(v.string()),
    // Nombre de personnes attendues (plafonné à la capacité de la salle).
    attendees: v.optional(v.number()),
    start: v.number(),
    end: v.number(),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_roomId", ["roomId"])
    .index("by_start", ["start"]),

  /**
   * Réservations de véhicules via Mes Outils (approbation requise). Les
   * réservations `approved` rendent le véhicule indisponible côté recyclerie
   * (cf. `vehicleBusyReason` dans fleet.ts).
   */
  vehicleReservations: defineTable({
    vehicleId: v.id("vehicles"),
    clerkId: v.string(),
    userName: v.string(),
    bookedByName: v.optional(v.string()),
    bookedForClerkId: v.optional(v.string()),
    purpose: v.string(),
    // Usage professionnel ou personnel (selon les droits du véhicule).
    usageType: v.optional(v.union(v.literal("pro"), v.literal("personal"))),
    // Kilométrage estimé par le demandeur.
    expectedKm: v.optional(v.number()),
    // Transport d'objets/matériel (déménagement, collecte volumineuse…).
    willTransport: v.optional(v.boolean()),
    transportDetails: v.optional(v.string()),
    start: v.number(),
    end: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    decisionNote: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_vehicleId", ["vehicleId"])
    .index("by_status", ["status"])
    .index("by_start", ["start"]),

  vehicleMaintenanceTasks: defineTable({
    vehicleId: v.id("vehicles"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
    dueDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    createdBy: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vehicleId", ["vehicleId"])
    .index("by_status", ["status"])
    .index("by_dueDate", ["dueDate"]),

  /** Documents rattachés à un véhicule (carte grise, facture, devis, assurance...). */
  vehicleDocuments: defineTable({
    vehicleId: v.id("vehicles"),
    name: v.string(),
    category: v.union(
      v.literal("carte_grise"),
      v.literal("facture"),
      v.literal("devis"),
      v.literal("assurance"),
      v.literal("controle_technique"),
      v.literal("autre"),
    ),
    storageId: v.id("_storage"),
    uploadedBy: v.string(),
    createdAt: v.number(),
  }).index("by_vehicleId", ["vehicleId"]),

  /** Espace partage — événements internes. */
  events: defineTable({
    authorClerkId: v.string(),
    authorName: v.string(),
    authorImageUrl: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    location: v.optional(v.string()),
    // Date optionnelle : un événement peut être publié sans créneau précis.
    start: v.optional(v.number()),
    end: v.optional(v.number()),
    images: v.array(v.id("_storage")),
    createdAt: v.number(),
  }).index("by_start", ["start"]),

  /** Espace partage — bons plans internes (prêt, don, vente, échange). */
  dealPosts: defineTable({
    authorClerkId: v.string(),
    authorName: v.string(),
    authorImageUrl: v.optional(v.string()),
    title: v.string(),
    description: v.string(),
    dealType: v.union(
      v.literal("pret"),
      v.literal("don"),
      v.literal("vente"),
      v.literal("echange"),
    ),
    price: v.optional(v.number()),
    availableFrom: v.optional(v.number()),
    availableTo: v.optional(v.number()),
    images: v.array(v.id("_storage")),
    status: v.union(v.literal("open"), v.literal("closed")),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  /** Messagerie interne entre utilisateurs. */
  directMessages: defineTable({
    pairKey: v.string(),
    fromClerkId: v.string(),
    fromName: v.string(),
    fromImageUrl: v.optional(v.string()),
    toClerkId: v.string(),
    toName: v.string(),
    body: v.string(),
    // Image jointe (ex. première photo d'un bon plan, sur le premier message).
    attachmentImageUrl: v.optional(v.string()),
    attachmentTitle: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_pair", ["pairKey", "createdAt"])
    .index("by_to", ["toClerkId"])
    .index("by_from", ["fromClerkId"]),

  /** Cycle en Bray — vélos reconditionnés, stock CRM et boutique publique. */
  bikes: defineTable({
    photos: v.array(v.id("_storage")),
    title: v.string(),
    description: v.string(),
    site: v.union(v.literal("60"), v.literal("76")),
    gdrReference: v.optional(v.string()),
    internalReference: v.optional(v.string()),
    category: v.string(),
    brand: v.optional(v.string()),
    model: v.optional(v.string()),
    condition: v.string(),
    useMode: v.optional(v.union(v.literal("purchase"), v.literal("rental"))),
    status: v.union(
      v.literal("inactive"),
      v.literal("available"),
      v.literal("purchase_pending"),
      v.literal("sold"),
      // Valeurs intermédiaires conservées pour compatibilité/migration.
      v.literal("waiting"),
      v.literal("online"),
      v.literal("draft"),
      v.literal("atelier"),
      v.literal("ready"),
      v.literal("reserved"),
      v.literal("archived"),
    ),
    pipelineStatus: v.optional(v.union(
      v.literal("nouveau"),
      v.literal("validation"),
      v.literal("en_cours"),
      v.literal("gagnee"),
      v.literal("perdue"),
    )),
    processStep: v.optional(v.number()),
    processLog: v.optional(v.array(v.object({
      step: v.number(),
      by: v.string(),
      at: v.number(),
    }))),
    customerName: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    customerPhone: v.optional(v.string()),
    customerNotes: v.optional(v.string()),
    price: v.optional(v.number()),
    originalPrice: v.optional(v.number()),
    sizeLabel: v.optional(v.string()),
    frameHeightCm: v.optional(v.number()),
    riderMinCm: v.optional(v.number()),
    riderMaxCm: v.optional(v.number()),
    wheelSize: v.optional(v.string()),
    frameMaterial: v.optional(v.string()),
    color: v.optional(v.string()),
    weightKg: v.optional(v.number()),
    brakeType: v.optional(v.string()),
    drivetrain: v.optional(v.string()),
    speeds: v.optional(v.number()),
    motor: v.optional(v.string()),
    batteryWh: v.optional(v.number()),
    autonomyKm: v.optional(v.number()),
    accessories: v.optional(v.array(v.string())),
    repairs: v.optional(v.array(v.string())),
    defects: v.optional(v.array(v.string())),
    location: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_site", ["site"])
    .index("by_category", ["category"])
    .index("by_gdrReference", ["gdrReference"])
    .index("by_featured", ["featured"])
    .index("by_createdAt", ["createdAt"]),

  cycleCustomers: defineTable({
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_email", ["email"]),

  cycleRequests: defineTable({
    requestKind: v.optional(v.union(v.literal("reservation"), v.literal("reebike"), v.literal("repair"))),
    bikeId: v.optional(v.id("bikes")),
    bikeTitle: v.string(),
    bikeGdrReference: v.optional(v.string()),
    customerId: v.id("cycleCustomers"),
    customer: v.object({
      firstName: v.string(),
      lastName: v.string(),
      email: v.string(),
      phone: v.string(),
      message: v.optional(v.string()),
    }),
    reebike: v.optional(v.object({
      desiredAt: v.string(),
      duration: v.optional(v.string()),
      formula: v.string(),
      frontBrake: v.string(),
      bikeType: v.string(),
      wheelSize: v.string(),
      compatibilityPhotos: v.optional(v.array(v.id("_storage"))),
    })),
    reservation: v.optional(v.object({
      rentalStart: v.optional(v.string()),
      rentalEnd: v.optional(v.string()),
    })),
    rental: v.optional(v.object({
      startDate: v.string(),
      endDate: v.string(),
    })),
    management: v.optional(v.object({
      site: v.optional(v.union(v.literal("60"), v.literal("76"))),
      assignedTo: v.optional(v.string()),
      notes: v.optional(v.string()),
    })),
    pipelineStatus: v.union(
      v.literal("nouveau"),
      v.literal("validation"),
      v.literal("en_cours"),
      v.literal("gagnee"),
      v.literal("perdue"),
    ),
    processStep: v.number(),
    processLog: v.optional(v.array(v.object({
      step: v.number(),
      by: v.string(),
      at: v.number(),
    }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pipelineStatus", ["pipelineStatus"])
    .index("by_bikeId", ["bikeId"])
    .index("by_customerId", ["customerId"])
    .index("by_createdAt", ["createdAt"]),

  /* ─── Klyd : boutique textile (base de données partagée, tables dédiées) ──── */

  /**
   * Articles textile de la boutique Klyd. Stockés dans une table dédiée
   * (et non dans `articles`) : les articles de la recyclerie et ceux de Klyd
   * restent ainsi totalement séparés, tout en partageant le même déploiement
   * Convex / la même base de données.
   */
  klydeItems: defineTable({
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
    quantity: v.number(),
    status: v.union(
      v.literal("stock"),
      v.literal("en_ligne"),
      v.literal("en_cours_envoi"),
      v.literal("envoye"),
      v.literal("gagne"),
      // Anciennes valeurs conservées pour les articles créés avant le suivi.
      v.literal("en_stock"),
      v.literal("reserve"),
      v.literal("vendu"),
      v.literal("archive"),
    ),
    aiConfidence: v.optional(v.number()),
    aiNotes: v.optional(v.string()),
    trackingNotes: v.optional(v.string()),
    featured: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_sku", ["sku"])
    .index("by_featured", ["featured"]),

  /** Klyde — commandes boutique créées après connexion client. */
  klydeOrders: defineTable({
    itemIds: v.array(v.id("klydeItems")),
    clerkId: v.string(),
    customer: v.object({
      firstName: v.string(),
      lastName: v.string(),
      email: v.string(),
      phone: v.string(),
    }),
    total: v.number(),
    status: v.union(v.literal("en_attente_paiement"), v.literal("payee")),
    paymentMethod: v.literal("card"),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_createdAt", ["createdAt"]),

  /** Klyde — wishlist client. */
  klydeWishlists: defineTable({
    clerkId: v.string(),
    itemId: v.id("klydeItems"),
    createdAt: v.number(),
  })
    .index("by_clerkId", ["clerkId"])
    .index("by_clerkId_itemId", ["clerkId", "itemId"])
    .index("by_itemId", ["itemId"]),

  /* ─── App « Bennes & Pro » : dépôts de déchets par les entreprises ──────── */

  /** Entreprises qui déposent des déchets sur le site. */
  bpCompanies: defineTable({
    name: v.string(),
    siret: v.optional(v.string()),
    address: v.optional(v.string()),
    contactName: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    /** Client Stripe associé (facturation du DIB). */
    stripeCustomerId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_name", ["name"]),

  /** Réglages Bennes & Pro (doc unique, key = "bennespro"). */
  bpSettings: defineTable({
    key: v.string(),
    /** Prix du DIB en centimes d'euro par kg (défaut : 34). */
    dibPriceCentsPerKg: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    updatedBy: v.optional(v.string()),
  }).index("by_key", ["key"]),

  /** Véhicules appartenant à une entreprise (bennes, camions...). */
  bpVehicles: defineTable({
    companyId: v.id("bpCompanies"),
    label: v.string(),
    plate: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_company", ["companyId"]),

  /** Dépôts de déchets. Les lignes de déchets sont embarquées dans le doc. */
  bpDepots: defineTable({
    depotNumber: v.number(),
    companyId: v.id("bpCompanies"),
    vehicleId: v.id("bpVehicles"),
    depositorName: v.string(),
    siteRef: v.string(),
    items: v.array(
      v.object({
        material: bpMaterial,
        unit: bpUnit,
        quantity: v.number(),
        siteRef: v.string(),
      }),
    ),
    ticketPhoto: v.optional(v.id("_storage")),
    truckExteriorPhoto: v.optional(v.id("_storage")),
    truckInteriorPhoto: v.optional(v.id("_storage")),
    attachments: v.array(v.id("_storage")),
    comment: v.optional(v.string()),
    signature: v.id("_storage"),
    /** Facturation Stripe du DIB (seul flux facturé, au poids). */
    billing: v.optional(bpBilling),
    createdBy: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_company", ["companyId"])
    .index("by_number", ["depotNumber"]),
  },
  { schemaValidation: false },
);
