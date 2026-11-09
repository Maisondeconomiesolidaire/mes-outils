/**
 * Optimisation de tournée Meslogistic.
 *
 * Pour un transit donné, on rassemble les transits ouverts et les navettes à
 * venir, on calcule les distances routières réelles entre tous les lieux
 * (Google Maps si `GOOGLE_MAPS_API_KEY` est configurée, sinon Mapbox), puis
 * OpenAI propose la meilleure navette : une navette existante à rejoindre, ou
 * une nouvelle navette à créer avant l'échéance. Le serveur valide la
 * proposition (navette existante, date ≤ échéance) avant de la renvoyer.
 */
import { ConvexError, v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireCrmPermission } from "./lib";
import { canonicalLocation } from "./meslogisticRules";

const PAGE = "meslogistic:demandes";

/** Lieux de l'écosystème : coordonnées connues, aucun géocodage nécessaire. */
const KNOWN_PLACES: Record<string, { name: string; address: string; latitude: number; longitude: number }> = {
  comptoir_c: { name: "Comptoir C", address: "13 Av. Pierre Bérégovoy, 60000 Beauvais", latitude: 49.439732, longitude: 2.104311 },
  recyclerie_pays_de_bray: { name: "Recyclerie du Pays de Bray", address: "4 Rue de la Prairie, 60650 Lachapelle-aux-Pots", latitude: 49.44225, longitude: 1.902468 },
  esspace_150: { name: "Esspace 150 / Recyclerie de Gournay", address: "150 Rte de Paris, 76220 Gournay-en-Bray", latitude: 49.469388, longitude: 1.725067 },
};

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

type Point = { label: string; address: string; latitude: number; longitude: number };

async function geocodePlace(label: string): Promise<Point | null> {
  const known = canonicalLocation(label);
  if (known && KNOWN_PLACES[known]) return { label, ...KNOWN_PLACES[known] };
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  try {
    if (googleKey) {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", label); url.searchParams.set("region", "fr"); url.searchParams.set("key", googleKey);
      const payload = await (await fetch(url)).json() as { results?: Array<{ formatted_address: string; geometry: { location: { lat: number; lng: number } } }> };
      const hit = payload.results?.[0];
      if (hit) return { label, address: hit.formatted_address, latitude: hit.geometry.location.lat, longitude: hit.geometry.location.lng };
    }
    const mapbox = process.env.MAPBOX_ACCESS_TOKEN;
    if (mapbox) {
      const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
      url.searchParams.set("q", label); url.searchParams.set("access_token", mapbox); url.searchParams.set("limit", "1"); url.searchParams.set("country", "FR"); url.searchParams.set("language", "fr");
      const payload = await (await fetch(url)).json() as { features?: Array<{ geometry?: { coordinates?: [number, number] }; properties?: { full_address?: string } }> };
      const hit = payload.features?.[0];
      const coords = hit?.geometry?.coordinates;
      if (coords) return { label, address: hit?.properties?.full_address ?? label, longitude: coords[0], latitude: coords[1] };
    }
  } catch { /* lieu non géolocalisé : l'IA raisonne sans sa distance */ }
  return null;
}

/** Matrice routière (km, minutes) entre tous les points. */
async function distanceMatrix(points: Point[]): Promise<{ km: (number | null)[][]; minutes: (number | null)[][]; provider: string }> {
  const empty = () => points.map(() => points.map(() => null as number | null));
  if (points.length < 2) return { km: empty(), minutes: empty(), provider: "aucun" };
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    const coords = points.map(point => `${point.latitude},${point.longitude}`).join("|");
    url.searchParams.set("origins", coords); url.searchParams.set("destinations", coords); url.searchParams.set("mode", "driving"); url.searchParams.set("key", googleKey);
    const payload = await (await fetch(url)).json() as { status?: string; rows?: Array<{ elements: Array<{ status: string; distance?: { value: number }; duration?: { value: number } }> }> };
    if (payload.status === "OK" && payload.rows) return {
      km: payload.rows.map(row => row.elements.map(cell => cell.status === "OK" && cell.distance ? Math.round(cell.distance.value / 100) / 10 : null)),
      minutes: payload.rows.map(row => row.elements.map(cell => cell.status === "OK" && cell.duration ? Math.round(cell.duration.value / 60) : null)),
      provider: "Google Maps",
    };
  }
  const mapbox = process.env.MAPBOX_ACCESS_TOKEN;
  if (mapbox) {
    const coords = points.map(point => `${point.longitude},${point.latitude}`).join(";");
    const url = new URL(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}`);
    url.searchParams.set("annotations", "distance,duration"); url.searchParams.set("access_token", mapbox);
    const payload = await (await fetch(url)).json() as { code?: string; distances?: (number | null)[][]; durations?: (number | null)[][] };
    if (payload.code === "Ok" && payload.distances && payload.durations) return {
      km: payload.distances.map(row => row.map(value => value === null ? null : Math.round(value / 100) / 10)),
      minutes: payload.durations.map(row => row.map(value => value === null ? null : Math.round(value / 60))),
      provider: "Mapbox",
    };
  }
  return { km: empty(), minutes: empty(), provider: "aucun" };
}

const SYSTEM_PROMPT = `Tu es le planificateur logistique de Meslogistic (réemploi de matériaux, Oise / Pays de Bray).
Une navette est une tournée en véhicule à une date donnée qui transporte plusieurs transits (lieu de départ → lieu d'arrivée).
Objectif : pour le transit CIBLE, proposer la meilleure navette.
Règles :
- La date de la navette doit être au plus tard l'échéance du transit cible (si elle existe) et pas avant aujourd'hui.
- Privilégie une navette EXISTANTE à venir si ses lieux sont sur le chemin ou proches (détour faible d'après la matrice des distances) : regrouper économise des kilomètres.
- Sinon, propose une NOUVELLE navette : date (AAAA-MM-JJ) avant l'échéance, idéalement en regroupant des transits ouverts non affectés aux trajets compatibles (même départ ou même arrivée, échéances proches).
- Donne l'ordre des arrêts de la tournée recommandée (libellés de lieux tels que fournis), en commençant par le premier chargement.
- Appuie-toi UNIQUEMENT sur les distances et durées fournies ; n'invente pas de distance.
Réponds en JSON strict :
{"choice":"existing"|"new","shuttleId":"<id d'une navette fournie si existing>","newShuttleName":"<si new>","newShuttleDate":"AAAA-MM-JJ si new","groupWith":["<ids de transits ouverts à embarquer aussi>"],"stops":["<lieu>", "..."],"estimatedKm":<nombre ou null>,"estimatedMinutes":<nombre ou null>,"summary":"<1 à 2 phrases>","reasons":["<raison courte>", "..."],"alternatives":[{"label":"<option>","why":"<pourquoi moins bien>"}]}`;

type Snapshot = { target: Transit; openTransits: Transit[]; shuttles: Array<{ _id: Id<"mlShuttles">; name: string; scheduledDate: string; transits: Transit[] }> };
type Recommendation = { kind: "existing"; shuttleId: Id<"mlShuttles">; name: string; date: string } | { kind: "new"; name: string; date: string };
export type ShuttleSuggestion = {
  recommendation: Recommendation | null; summary: string; reasons: string[]; alternatives: Array<{ label: string; why: string }>;
  groupWith: Array<{ _id: Id<"mlRequests">; reference: string; title: string; origin: string; destination: string; dueDate?: string }>;
  stops: Array<{ label: string; address: string }>; estimatedKm: number | null; estimatedMinutes: number | null;
  distanceProvider: string; unlocated: string[]; warnings: string[]; model: string;
};

type AiAnswer = {
  choice?: string; shuttleId?: string; newShuttleName?: string; newShuttleDate?: string; groupWith?: string[]; stops?: string[];
  estimatedKm?: number | null; estimatedMinutes?: number | null; summary?: string; reasons?: string[]; alternatives?: Array<{ label?: string; why?: string }>;
};

export const suggestShuttle = action({
  args: { requestId: v.id("mlRequests") },
  handler: async (ctx, { requestId }): Promise<ShuttleSuggestion> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ConvexError("Clé OpenAI non configurée (OPENAI_API_KEY).");
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
    const snapshot: Snapshot = await ctx.runQuery(internal.meslogisticAi.planningSnapshot, { requestId, today });
    if (snapshot.target.status !== "a_preparer") throw new ConvexError("Ce transit est déjà parti ou clôturé.");

    // Lieux utiles : ceux du transit, des navettes à venir et des transits ouverts non affectés.
    const unassigned = snapshot.openTransits.filter(row => row.status === "a_preparer" && !row.shuttleId).slice(0, 40);
    const labels: string[] = [];
    const add = (label: string) => { const key = label.trim(); if (key && !labels.some(item => item.toLocaleLowerCase("fr-FR") === key.toLocaleLowerCase("fr-FR"))) labels.push(key); };
    add(snapshot.target.origin); add(snapshot.target.destination);
    for (const shuttle of snapshot.shuttles) for (const row of shuttle.transits) { add(row.origin); add(row.destination); }
    for (const row of unassigned) { add(row.origin); add(row.destination); }
    const resolved = (await Promise.all(labels.slice(0, 20).map(geocodePlace)));
    const points = resolved.filter((point): point is Point => Boolean(point));
    const matrix = await distanceMatrix(points);

    const context = {
      aujourdhui: today,
      transitCible: { id: snapshot.target._id, reference: snapshot.target.reference, objet: `${snapshot.target.quantity} ${snapshot.target.unit} · ${snapshot.target.title}`, depart: snapshot.target.origin, arrivee: snapshot.target.destination, echeance: snapshot.target.dueDate ?? null },
      navettesAVenir: snapshot.shuttles.map(shuttle => ({ id: shuttle._id, nom: shuttle.name, date: shuttle.scheduledDate, transits: shuttle.transits.map(row => ({ reference: row.reference, depart: row.origin, arrivee: row.destination, echeance: row.dueDate ?? null })) })),
      transitsOuvertsNonAffectes: unassigned.map(row => ({ id: row._id, reference: row.reference, objet: `${row.quantity} ${row.unit} · ${row.title}`, depart: row.origin, arrivee: row.destination, echeance: row.dueDate ?? null })),
      lieux: points.map(point => ({ lieu: point.label, adresse: point.address })),
      lieuxNonGeolocalises: labels.filter(label => !points.some(point => point.label === label)),
      distancesRoutieres: { source: matrix.provider, unite: "km / minutes", matrice: points.flatMap((from, i) => points.map((to, j) => i === j ? null : { de: from.label, vers: to.label, km: matrix.km[i]?.[j], minutes: matrix.minutes[i]?.[j] }).filter(Boolean)) },
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
        body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1200, response_format: { type: "json_object" }, messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(context) }] }),
      });
      if (!response.ok) { lastError = `(${response.status}) ${(await response.text()).slice(0, 200)}`; continue; }
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      try { answer = JSON.parse(data.choices?.[0]?.message?.content ?? "") as AiAnswer; usedModel = model; break; } catch { lastError = "réponse illisible"; }
    }
    if (!answer) throw new ConvexError(`L’IA n’a pas pu proposer de navette. ${lastError}`);

    // Garde-fous : l'IA ne peut proposer qu'une navette existante fournie, à une date valide.
    const due = snapshot.target.dueDate;
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
    const groupWith = unassigned.filter(row => answer!.groupWith?.includes(row._id)).map(row => ({ _id: row._id, reference: row.reference, title: row.title, origin: row.origin, destination: row.destination, dueDate: row.dueDate }));
    const stops = (answer.stops ?? []).filter(stop => typeof stop === "string").slice(0, 12).map(stop => {
      const point = points.find(item => item.label.toLocaleLowerCase("fr-FR") === stop.toLocaleLowerCase("fr-FR"));
      return { label: stop, address: point?.address ?? stop };
    });
    return {
      recommendation,
      summary: answer.summary ?? "",
      reasons: (answer.reasons ?? []).filter(reason => typeof reason === "string").slice(0, 6),
      alternatives: (answer.alternatives ?? []).filter(item => item?.label).slice(0, 3).map(item => ({ label: item.label!, why: item.why ?? "" })),
      groupWith,
      stops,
      estimatedKm: typeof answer.estimatedKm === "number" ? answer.estimatedKm : null,
      estimatedMinutes: typeof answer.estimatedMinutes === "number" ? answer.estimatedMinutes : null,
      distanceProvider: matrix.provider,
      unlocated: context.lieuxNonGeolocalises,
      warnings,
      model: usedModel,
    };
  },
});
