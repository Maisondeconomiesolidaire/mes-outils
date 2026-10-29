import { internalMutation } from "./_generated/server";

function categoryPathFor(article: { title: string; category: string; subcategory?: string }) {
  const title = article.title.toLowerCase();

  if (article.category === "Électronique") {
    return title.includes("photo")
      ? ["High-Tech", "Photos, caméras", "Appareils photo"]
      : ["High-Tech", "Son, casques, écouteurs", "Hi-fi et lecteurs MP3/MP4"];
  }

  if (article.category === "Maison et Jardin") {
    if (article.subcategory === "Ameublement") return ["Maison", "Mobilier", "Meubles de rangement"];
    if (article.subcategory === "Vaisselle") {
      if (title.includes("cocotte")) return ["Maison", "Arts de la table", "Casseroles"];
      if (title.includes("assiette")) return ["Maison", "Arts de la table", "Assiettes"];
      return ["Maison", "Arts de la table", "Plats, saladiers, coupes"];
    }
    if (article.subcategory === "Électroménager") {
      return title.includes("hachoir")
        ? ["Loisirs", "Bricolage, outils, pièces détachées", "Outillage"]
        : ["Maison", "Électroménager"];
    }
    if (title.includes("livre")) return ["Librairie"];
    if (title.includes("réveil")) return ["Maison", "Décoration", "Horloges, pendules, réveils"];
    if (title.includes("assiette")) return ["Maison", "Décoration", "Assiettes décoratives"];
    if (title.includes("spider-man")) return ["Maison", "Décoration", "Affiches, posters, illustrations"];
    return ["Maison", "Décoration", "Autres objets déco"];
  }

  if (article.subcategory === "DVD - Films") return ["Loisirs", "Musique et multimédia", "DVDs"];
  if (article.subcategory === "Livres") {
    if (title.includes("paris match")) return ["Librairie", "Livres anciens, revues rétro", "Revues, magazines rétro et récents"];
    if (title.includes("mickey") || title.includes("bande dessinée")) return ["Librairie", "BD, mangas", "BDs jeunesse"];
    return ["Librairie"];
  }
  if (title.includes("puzzle")) return ["Loisirs", "Jeux, jouets et puériculture", "Puzzles"];
  if (title.includes("jeu de société")) return ["Loisirs", "Jeux 12 ans et +", "Jeux de société"];
  if (/(figurine|robot|transform|stormtrooper|big jim|popeye|pikachu|buzz)/.test(title)) {
    return ["Loisirs", "Jeux 12 ans et +", "Héros, figurines, robots"];
  }
  if (/(voiture|moto|garage|hélicoptère|bateau)/.test(title)) {
    return ["Loisirs", "Jeux, jouets et puériculture", "Véhicules et circuits"];
  }
  return ["Loisirs"];
}

/** Migration ponctuelle des catégories historiques du stock Recycapp. */
export const remapExistingStock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const articles = await ctx.db.query("articles").take(500);
    let updated = 0;
    for (const article of articles) {
      const categoryPath = categoryPathFor(article);
      await ctx.db.patch(article._id, {
        category: categoryPath[0],
        subcategory: categoryPath[1],
        categoryPath,
      });
      updated += 1;
    }
    return { updated };
  },
});
