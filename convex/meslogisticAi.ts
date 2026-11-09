/**
 * Optimisation de tournée Meslogistic, par les lieux.
 *
 * Pour un transit donné, on rassemble les navettes à venir et les transits
 * ouverts, puis on calcule les correspondances de lieux (même départ, même
 * arrivée, lieu en commun). OpenAI s'appuie sur ces correspondances pour
 * proposer la meilleure navette : une navette existante qui passe par les
 * mêmes lieux, ou une nouvelle navette avant l'échéance qui regroupe les
 * demandes allant aux mêmes endroits. Le serveur valide la proposition.
 */
import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";
import { canonicalLocation, onTheWay, sameDirection, tourStops } from "./meslogisticRules";

const PAGE = "meslogistic:demandes";

type Transit = { _id: Id<"mlRequests">; reference: string; title: string; quantity: number; unit: string; origin: string; destination: string; dueDate?: string; status: string; shuttleId?: Id<"mlShuttles"> };

/** Contexte de planification, lu avec les droits de l'utilisateur. */
export const planningSnapshot = internalQuery({
  args: { requestId: v.id("mlRequests"), today: v.string() },
  handler: async (ctx, { requestId, today }) => {
    await requireCrmPermission(ctx, PAGE, "read");
    const target = await ctx.db.get(requestId);
    if (!target) throw new ConvexError("Demande introuvable.");
    const pick = (row: typeof target): Transit => ({ _id: row._id, reference: row.reference, title: row.title, quantity: row.quantity, unit: row.unit, origin: row.origin, destination: row.destination, dueDate: row.dueDate, status: row.status, shuttleId: row.shuttleId });
    const open = [
      ...(await ctx.db.query("mlRequests").withIndex("by_status", q => q.eq("status", "a_preparer")).take(200)),
      ...(await ctx.db.query("mlRequests").withIndex("by_status", q => q.eq("status", "en_transit")).take(200)),
    ];
    const shuttles = (await ctx.db.query("mlShuttles").order("desc").take(200)).filter(shuttle => shuttle.scheduledDate >= today);
    return {
      target: pick(target),
      openTransits: open.filter(row => row._id !== target._id).map(pick),
      shuttles: await Promise.all(shuttles.map(async shuttle => ({
        _id: shuttle._id, name: shuttle.name, scheduledDate: shuttle.scheduledDate,
        transits: (await ctx.db.query("mlRequests").withIndex("by_shuttleId", q => q.eq("shuttleId", shuttle._id)).take(50)).filter(row => row.status !== "annulee").map(pick),
      }))),
    };
  },
});

/** Lieu comparable : identifiant canonique pour les sites connus, sinon le libellé normalisé. */
const placeKey = (label: string) => canonicalLocation(label) ?? label.trim().toLocaleLowerCase("fr-FR");

/** Correspondance de lieux entre le transit cible et un ensemble de trajets. */
function placeMatch(target: { origin: string; destination: string }, trips: { origin: string; destination: string }[]) {
  const from = placeKey(target.origin), to = placeKey(target.destination);
  const sameRoute = trips.some(trip => placeKey(trip.origin) === from && placeKey(trip.destination) === to);
  const sameOrigin = trips.some(trip => placeKey(trip.origin) === from);
  const sameDestination = trips.some(trip => placeKey(trip.destination) === to);
  const visited = new Set(trips.flatMap(trip => [placeKey(trip.origin), placeKey(trip.destination)]));
  const servesBoth = visited.has(from) && visited.has(to);
  // Sur l'axe Comptoir C — Solidarium — Esspace 150 : la tournée passe-t-elle déjà par ce trajet ?
  const coversTarget = trips.some(trip => onTheWay(trip, target));
  const carriedOnTheWay = trips.some(trip => onTheWay(target, trip));
  const sameWay = trips.some(trip => sameDirection(target, trip));
  const score = (sameRoute ? 4 : 0) + (coversTarget ? 3 : 0) + (servesBoth ? 2 : 0) + (carriedOnTheWay ? 2 : 0) + (sameOrigin ? 1 : 0) + (sameDestination ? 1 : 0) + (sameWay ? 1 : 0);
  const labels = [
    sameRoute && "même trajet",
    !sameRoute && coversTarget && "passe par ce trajet",
    !sameRoute && !coversTarget && carriedOnTheWay && "sur le chemin",
    !sameRoute && !coversTarget && servesBoth && "passe par le départ et l’arrivée",
    !sameRoute && sameOrigin && "même départ",
    !sameRoute && sameDestination && "même arrivée",
    !sameRoute && !coversTarget && !carriedOnTheWay && sameWay && "même sens",
  ].filter(Boolean) as string[];
  return { score, labels };
}

const SYSTEM_PROMPT = `Tu es le planificateur logistique de Meslogistic (réemploi de matériaux, Oise / Pays de Bray).
Une navette est une tournée à une date donnée qui transporte plusieurs transits (lieu de départ → lieu d'arrivée).
Objectif : pour le transit CIBLE, proposer la meilleure navette en raisonnant UNIQUEMENT sur les lieux et les dates.
GÉOGRAPHIE (à retenir absolument) : les trois sites sont alignés sur un même axe.
  Comptoir C (extrémité gauche) — Solidarium / Recyclerie du Pays de Bray (au milieu) — Esspace 150 (extrémité droite).
  Aller du Comptoir C à l'Esspace 150 (ou l'inverse) fait PASSER PAR le Solidarium. Le plus loin du Comptoir C est l'Esspace 150, et inversement.
  Une tournée parcourt l'axe dans un sens : elle charge et décharge au passage. Ne propose JAMAIS un ordre qui revient sur ses pas inutilement (ex. Comptoir C → Esspace 150 → Solidarium est absurde : on passe par le Solidarium en allant à l'Esspace 150 ; le bon ordre est Comptoir C → Solidarium → Esspace 150).
Règles :
- La date de la navette doit être au plus tard l'échéance du transit cible (si elle existe) et pas avant aujourd'hui.
- Privilégie une navette EXISTANTE à venir qui passe par les mêmes lieux (le champ "correspondance" indique : même trajet, passe par le départ et l'arrivée, même départ, même arrivée). Plus la correspondance est forte, mieux c'est.
- Sinon, propose une NOUVELLE navette : date (AAAA-MM-JJ) avant l'échéance.
- Propose TOUJOURS d'embarquer les autres transits ouverts compatibles (groupWith) : en priorité ceux "sur le chemin" (même sens, trajet compris dans la tournée), puis ceux de même départ / même arrivée, avec des échéances compatibles avec la date de la navette.
- Donne l'ordre des arrêts en balayant l'axe dans un sens (puis retour éventuel pour les trajets de sens inverse), en commençant par le premier chargement.
- N'invente ni distance ni durée.
- LANGUE : tous les textes (summary, reasons, alternatives, newShuttleName) sont rédigés en FRANÇAIS, jamais en anglais. Seules les clés JSON restent en anglais.
Réponds en JSON strict :
{"choice":"existing"|"new","shuttleId":"<id d'une navette fournie si existing>","newShuttleName":"<si new>","newShuttleDate":"AAAA-MM-JJ si new","groupWith":["<ids de transits ouverts à embarquer aussi>"],"stops":["<lieu>", "..."],"summary":"<1 à 2 phrases>","reasons":["<raison courte>", "..."],"alternatives":[{"label":"<option>","why":"<pourquoi moins bien>"}]}`;

type Snapshot = { target: Transit; openTransits: Transit[]; shuttles: Array<{ _id: Id<"mlShuttles">; name: string; scheduledDate: string; transits: Transit[] }> };
type Recommendation = { kind: "existing"; shuttleId: Id<"mlShuttles">; name: string; date: string } | { kind: "new"; name: string; date: string };
export type ShuttleSuggestion = {
  recommendation: Recommendation | null; summary: string; reasons: string[]; alternatives: Array<{ label: string; why: string }>;
  groupWith: Array<{ _id: Id<"mlRequests">; reference: string; title: string; origin: string; destination: string; dueDate?: string }>;
  stops: string[];
  /** Correspondances de lieux calculées pour chaque navette à venir (indépendantes de l'IA). */
  matches: Array<{ shuttleId: Id<"mlShuttles">; labels: string[]; score: number; afterDueDate: boolean }>;
  warnings: string[]; model: string;
};

type AiAnswer = {
  choice?: string; shuttleId?: string; newShuttleName?: string; newShuttleDate?: string; groupWith?: string[]; stops?: string[];
  summary?: string; reasons?: string[]; alternatives?: Array<{ label?: string; why?: string }>;
};

export const suggestShuttle = action({
  args: { requestId: v.id("mlRequests") },
  handler: async (ctx, { requestId }): Promise<ShuttleSuggestion> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ConvexError("Clé OpenAI non configurée (OPENAI_API_KEY).");
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    const snapshot: Snapshot = await ctx.runQuery(internal.meslogisticAi.planningSnapshot, { requestId, today });
    const target = snapshot.target;
    if (target.status !== "a_preparer") throw new ConvexError("Ce transit est déjà parti ou clôturé.");
    const due = target.dueDate;

    const matches = snapshot.shuttles.map(shuttle => ({ shuttleId: shuttle._id, ...placeMatch(target, shuttle.transits), afterDueDate: Boolean(due && shuttle.scheduledDate > due) }));
    const unassigned = snapshot.openTransits.filter(row => row.status === "a_preparer" && !row.shuttleId);
    // Transits non affectés qui partagent un lieu avec la cible : candidats au regroupement.
    const compatible = unassigned.map(row => ({ row, ...placeMatch(target, [row]) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 30);

    const context = {
      aujourdhui: today,
      transitCible: { id: target._id, reference: target.reference, objet: `${target.quantity} ${target.unit} · ${target.title}`, depart: target.origin, arrivee: target.destination, echeance: due ?? null },
      navettesAVenir: snapshot.shuttles.map((shuttle, index) => ({
        id: shuttle._id, nom: shuttle.name, date: shuttle.scheduledDate, apresEcheance: matches[index].afterDueDate,
        correspondance: matches[index].labels.length ? matches[index].labels : ["aucun lieu en commun"],
        trajets: shuttle.transits.map(row => `${row.origin} → ${row.destination}`),
      })),
      transitsOuvertsCompatibles: compatible.map(({ row, labels }) => ({ id: row._id, reference: row.reference, objet: `${row.quantity} ${row.unit} · ${row.title}`, depart: row.origin, arrivee: row.destination, echeance: row.dueDate ?? null, correspondance: labels })),
    };

    const preferred = process.env.OPENAI_REQUEST_ANALYSIS_MODEL?.trim();
    const models = Array.from(new Set([preferred, "gpt-4o"].filter(Boolean))) as string[];
    let answer: AiAnswer | null = null;
    let usedModel = "";
    let lastError = "";
    for (const model of models) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1000, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: `Propose la meilleure navette pour le transit cible. Rédige toutes tes explications en français.

${JSON.stringify(context)}` }] }),
      });
      if (!response.ok) { lastError = `(${response.status}) ${(await response.text()).slice(0, 200)}`; continue; }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      try { answer = JSON.parse(data.choices?.[0]?.message?.content ?? "") as AiAnswer; usedModel = model; break; } catch { lastError = "réponse illisible"; }
    }
    if (!answer) throw new ConvexError(`L’IA n’a pas pu proposer de navette. ${lastError}`);

    // Garde-fous : seule une navette fournie peut être proposée, à une date valide.
    const existing = answer.choice === "existing" ? snapshot.shuttles.find(shuttle => shuttle._id === answer!.shuttleId) : undefined;
    const isoOk = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= today && (!due || value <= due));
    const warnings: string[] = [];
    let recommendation: Recommendation | null = null;
    if (existing) {
      recommendation = { kind: "existing", shuttleId: existing._id, name: existing.name, date: existing.scheduledDate };
      if (due && existing.scheduledDate > due) warnings.push("Cette navette part après l’échéance.");
    } else if (answer.choice === "new" && isoOk(answer.newShuttleDate)) {
      recommendation = { kind: "new", name: (answer.newShuttleName?.trim() || `Navette ${answer.newShuttleDate}`).slice(0, 100), date: answer.newShuttleDate! };
    } else {
      warnings.push("La proposition de l’IA n’était pas exploitable (navette inconnue ou date hors échéance).");
    }
    return {
      recommendation,
      summary: answer.summary ?? "",
      reasons: (answer.reasons ?? []).filter(reason => typeof reason === "string").slice(0, 6),
      alternatives: (answer.alternatives ?? []).filter(item => item?.label).slice(0, 3).map(item => ({ label: item.label!, why: item.why ?? "" })),
      groupWith: compatible.map(item => item.row).filter(row => answer!.groupWith?.includes(row._id)).map(row => ({ _id: row._id, reference: row.reference, title: row.title, origin: row.origin, destination: row.destination, dueDate: row.dueDate })),
      // L'ordre des arrêts suit l'axe des sites quand tous les lieux sont connus ; sinon celui de l'IA.
      stops: tourStops([target, ...(existing?.transits ?? []), ...compatible.map(item => item.row).filter(row => answer!.groupWith?.includes(row._id))])
        ?? (answer.stops ?? []).filter(stop => typeof stop === "string").slice(0, 12),
      matches,
      warnings,
      model: usedModel,
    };
  },
});
