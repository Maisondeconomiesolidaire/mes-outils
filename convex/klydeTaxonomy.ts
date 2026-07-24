/**
 * Taxonomie Klyd issue du référentiel fourni (Femmes, Hommes, Créateurs,
 * Enfants). Les clés suivent : Genre → Catégorie → Sous-catégorie →
 * Sous-sous-catégorie. Une liste vide signifie qu'il n'existe pas de niveau
 * plus précis dans le référentiel.
 */
export const KLYDE_TAXONOMY = {
  Femme: {
    "Vêtements": {
      Robes: ["Robes courtes", "Robes mi-longues", "Robes longues", "Robes de soirée", "Robes de mariée", "Robes d’été", "Robes pull", "Robes portefeuille", "Autres robes"],
      "Tops et tee-shirts": ["Tee-shirts", "Débardeurs", "Tops courts", "Tops à manches longues", "Polos", "Tuniques", "Bodys", "Blouses", "Chemisiers"],
      "Pulls et sweats": ["Pulls", "Cardigans et gilets", "Sweats", "Sweats à capuche", "Pulls sans manches", "Cols roulés"],
      Pantalons: ["Pantalons droits", "Pantalons larges", "Pantalons taille haute", "Pantalons habillés", "Pantalons cargo", "Pantalons en cuir", "Leggings", "Pantacourts"],
      Jeans: ["Skinny", "Slim", "Droits", "Mom", "Boyfriend", "Bootcut", "Flare", "Larges", "Taille haute"],
      Jupes: ["Mini-jupes", "Jupes midi", "Jupes longues", "Jupes plissées", "Jupes crayon", "Jupes en jean", "Jupes en cuir"],
      Shorts: ["Shorts en jean", "Shorts taille haute", "Shorts de sport", "Shorts habillés"],
      "Combinaisons et salopettes": ["Combinaisons", "Combishorts", "Salopettes"],
      "Costumes et blazers": ["Blazers", "Vestes de costume", "Costumes", "Ensembles", "Gilets de costume"],
      "Vestes et manteaux": ["Manteaux", "Trenchs", "Parkas", "Doudounes", "Blousons", "Vestes en jean", "Vestes en cuir", "Bombers", "Vestes sans manches", "Imperméables", "Vestes polaires", "Capes et ponchos"],
      "Lingerie et vêtements de nuit": ["Soutiens-gorge", "Culottes", "Ensembles de lingerie", "Bodys", "Corsets", "Pyjamas", "Chemises de nuit", "Peignoirs", "Chaussettes", "Collants"],
      "Maillots de bain": ["Maillots une pièce", "Bikinis", "Hauts de bikini", "Bas de bikini", "Paréos"],
      "Vêtements de sport": [], "Vêtements de grossesse": [], "Vêtements traditionnels": [], "Vêtements vintage": [], "Autres vêtements": [],
    },
    Chaussures: { Baskets: [], "Baskets montantes": [], "Chaussures de sport": [], Bottines: [], Bottes: [], "Bottes de pluie": [], Escarpins: [], Sandales: [], "Sandales à talons": [], Mules: [], Sabots: [], Mocassins: [], "Derbies et richelieus": [], Ballerines: [], Espadrilles: [], Tongs: [], Chaussons: [], "Chaussures compensées": [], "Chaussures à plateforme": [], "Chaussures de mariage": [] },
    Sacs: { "Sacs à main": [], "Sacs à bandoulière": [], "Sacs à dos": [], "Sacs cabas": [], "Sacs seau": [], Pochettes: [], "Sacs banane": [], "Sacs de voyage": [], "Sacs pour ordinateur": [], Portefeuilles: [], "Porte-monnaie": [], Trousses: [] },
    Accessoires: { Bijoux: ["Colliers", "Bracelets", "Bagues", "Boucles d’oreilles", "Broches", "Chaînes de cheville", "Bijoux de corps", "Parures"], Montres: [], Ceintures: [], "Écharpes et foulards": [], "Chapeaux et casquettes": [], Bonnets: [], Gants: [], "Lunettes de soleil": [], "Accessoires pour cheveux": [], "Porte-clés": [], Parapluies: [], "Accessoires technologiques": [], "Autres accessoires": [] },
  },
  Homme: {
    "Vêtements": {
      "Tee-shirts": [], Polos: [], Chemises: ["Chemises habillées", "Chemises décontractées", "Chemises à manches courtes", "Surchemises"], "Pulls et gilets": [], Sweats: [], "Sweats à capuche": [],
      Jeans: ["Skinny", "Slim", "Droits", "Larges", "Bootcut"], Pantalons: ["Chinos", "Pantalons habillés", "Cargos", "Jogging", "Pantalons de travail"], Shorts: [],
      Costumes: ["Costumes complets", "Vestes de costume", "Pantalons de costume", "Gilets de costume"],
      "Vestes et manteaux": ["Manteaux", "Trenchs", "Parkas", "Doudounes", "Bombers", "Vestes en jean", "Vestes en cuir", "Vestes de travail", "Imperméables", "Polaires"],
      "Sous-vêtements": [], Pyjamas: [], "Maillots de bain": [], "Vêtements de sport": [], "Vêtements de travail": [], "Vêtements traditionnels": [], "Autres vêtements": [],
    },
    Chaussures: { Baskets: [], "Chaussures de sport": [], Bottines: [], Bottes: [], Mocassins: [], Derbies: [], Richelieus: [], Sandales: [], Tongs: [], Espadrilles: [], Chaussons: [], "Chaussures de sécurité": [] },
    "Sacs et accessoires": { "Sacs à dos": [], "Sacs à bandoulière": [], "Sacs banane": [], "Sacs de voyage": [], "Sacs pour ordinateur": [], Portefeuilles: [], Montres: [], Bijoux: [], Ceintures: [], Cravates: [], "Nœuds papillon": [], Bretelles: [], Chapeaux: [], Casquettes: [], Bonnets: [], Écharpes: [], Gants: [], "Lunettes de soleil": [], "Porte-clés": [] },
  },
  Enfant: {
    "Vêtements": {
      Filles: ["Bodies", "Tee-shirts", "Tops", "Chemisiers", "Pulls", "Sweats", "Robes", "Jupes", "Jeans", "Pantalons", "Leggings", "Shorts", "Combinaisons", "Pyjamas", "Sous-vêtements", "Maillots de bain", "Vestes", "Manteaux", "Doudounes", "Tenues de cérémonie", "Déguisements", "Vêtements de sport"],
      Garçons: ["Bodies", "Tee-shirts", "Polos", "Chemises", "Pulls", "Sweats", "Jeans", "Pantalons", "Jogging", "Shorts", "Pyjamas", "Sous-vêtements", "Maillots de bain", "Vestes", "Manteaux", "Doudounes", "Costumes", "Déguisements", "Vêtements de sport"],
      "Vêtements mixtes et bébé": ["Prématuré", "Naissance", "Ensembles", "Grenouillères", "Barboteuses", "Bodies", "Pyjamas", "Combinaisons", "Gigoteuses", "Chaussettes", "Bonnets", "Moufles"],
    },
    Chaussures: { "Chaussures pour enfants": ["Baskets", "Chaussures premiers pas", "Bottines", "Bottes", "Bottes de pluie", "Sandales", "Chaussons", "Chaussures habillées", "Chaussures de sport"] },
    Accessoires: { Accessoires: ["Sacs à dos", "Casquettes", "Bonnets", "Écharpes", "Gants", "Ceintures", "Lunettes", "Bijoux", "Accessoires pour cheveux"] },
  },
  Unisexe: {
    "Articles de créateurs": { "Articles de créateurs": ["Vêtements de créateurs", "Chaussures de créateurs", "Sacs de créateurs", "Bijoux de créateurs", "Montres de créateurs", "Accessoires de créateurs", "Articles pour femmes", "Articles pour hommes", "Articles pour enfants"] },
    "Vêtements": { "Autres vêtements": [] },
    Chaussures: { Baskets: [], "Chaussures de sport": [] },
    Accessoires: { "Autres accessoires": [] },
  },
} as const;

export const KLYDE_GENDERS = Object.keys(KLYDE_TAXONOMY) as Array<keyof typeof KLYDE_TAXONOMY>;

const normalize = (value?: string | null) => value?.trim().normalize("NFC") ?? "";

function taxonomyForGender(gender?: string | null) {
  return KLYDE_TAXONOMY[normalize(gender) as keyof typeof KLYDE_TAXONOMY];
}

export function klydeCategories(gender?: string | null) {
  const selected = taxonomyForGender(gender);
  if (selected) return Object.keys(selected);
  return Array.from(new Set(Object.values(KLYDE_TAXONOMY).flatMap((tree) => Object.keys(tree))));
}

export function klydeSubcategories(gender: string | null | undefined, category: string | null | undefined) {
  const normalizedCategory = normalize(category);
  const selected = taxonomyForGender(gender);
  if (selected?.[normalizedCategory as keyof typeof selected]) {
    return Object.keys(selected[normalizedCategory as keyof typeof selected]);
  }
  return Array.from(new Set(Object.values(KLYDE_TAXONOMY).flatMap((tree) => {
    const branch = tree[normalizedCategory as keyof typeof tree];
    return branch ? Object.keys(branch) : [];
  })));
}

export function klydeSubsubcategories(gender: string | null | undefined, category: string | null | undefined, subcategory: string | null | undefined): string[] {
  const selected = taxonomyForGender(gender);
  const branch = selected?.[normalize(category) as keyof typeof selected];
  const leaves = branch?.[normalize(subcategory) as keyof typeof branch] as readonly string[] | undefined;
  return leaves ? [...leaves] : [];
}

export function isKlydeTaxonomyChoice(gender: string | null | undefined, category: string, subcategory?: string | null, subsubcategory?: string | null) {
  const selected = taxonomyForGender(gender);
  const branch = selected?.[normalize(category) as keyof typeof selected];
  if (!branch) return false;
  if (!subcategory) return true;
  const leaves = branch[normalize(subcategory) as keyof typeof branch] as readonly string[] | undefined;
  if (!leaves) return false;
  return !subsubcategory || leaves.length === 0 || leaves.includes(normalize(subsubcategory) as never);
}

/** Poids moyen en kg d'un article seul. Les chaussures sont estimées par paire. */
export function klydeAverageWeightKg(category?: string | null, subcategory?: string | null, subsubcategory?: string | null) {
  const label = `${normalize(category)} ${normalize(subcategory)} ${normalize(subsubcategory)}`.toLocaleLowerCase("fr-FR");
  const has = (pattern: RegExp) => pattern.test(label);
  if (has(/robe de mariée/)) return 1.8;
  if (has(/robe de soirée|manteau|parka|doudoune|peignoir|gigoteuse/)) return 1.2;
  if (has(/bottes de pluie|bottes|chaussures de sécurité/)) return 1.5;
  if (has(/bottines|baskets montantes/)) return 1.1;
  if (has(/baskets|derbies|richelieus|mocassins|chaussures/)) return 0.8;
  if (has(/escarpins|sandales|mules|sabots|espadrilles|ballerines|tongs/)) return 0.55;
  if (has(/sacs de voyage/)) return 1.1;
  if (has(/sacs pour ordinateur|sacs à dos|sacs cabas/)) return 0.75;
  if (has(/sac|pochette|portefeuille|trousse/)) return 0.4;
  if (has(/jeans|salopettes|pantalons en cuir|pantalons cargo|pantalons de travail/)) return 0.65;
  if (has(/pantalon|chino|jogging|legging|pantacourt/)) return 0.45;
  if (has(/combinaison|costume complet|ensemble/)) return 0.8;
  if (has(/blazer|veste de costume|vestes en cuir|blouson|bomber/)) return 0.75;
  if (has(/veste|trench|imperméable|cape|poncho|polaire/)) return 0.65;
  if (has(/pull|cardigan|gilet|sweat|col roulé/)) return 0.55;
  if (has(/robe longue|robe pull/)) return 0.55;
  if (has(/robe/)) return 0.35;
  if (has(/jupe en jean|jupe en cuir/)) return 0.45;
  if (has(/jupe/)) return 0.3;
  if (has(/short en jean|short habillé/)) return 0.35;
  if (has(/short/)) return 0.25;
  if (has(/chemise|blouse|tunique|polo/)) return 0.3;
  if (has(/tee-shirts|tee-shirt|débardeur|top|body/)) return 0.2;
  if (has(/pyjama|grenouillère|barboteuse/)) return 0.35;
  if (has(/soutien|culotte|lingerie|maillot|bikini|paréo|collant|chaussettes/)) return 0.15;
  if (has(/bijou|montre|lunettes|porte-clés|accessoires pour cheveux/)) return 0.08;
  if (has(/ceinture|cravate|bretelles|gants|bonnet|casquette|chapeau|écharpe|foulard|parapluie/)) return 0.2;
  if (has(/bébé|naissance|prématuré|moufles/)) return 0.15;
  return 0.4;
}
