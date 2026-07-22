import { v } from "convex/values";
import { env, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireCrmPermission } from "./lib";

const FLEET_PAGE_KEY = "mesoutils:gotravaux";

const priority = v.union(v.literal("low"), v.literal("medium"), v.literal("high"));

type RemarkSnapshot = {
  vehicle: { name: string; plate?: string; brand?: string; model?: string; odometerKm?: number };
  remarks: Array<{
    submittedAt: number;
    userName: string;
    purpose: string;
    mileage?: number;
    fuelRestored?: boolean;
    vehicleEmpty?: boolean;
    vehicleClean?: boolean;
    issues?: string;
    notes?: string;
  }>;
};

const ANALYST_INSTRUCTIONS = [
  "Tu es un mécanicien automobile senior spécialisé dans le diagnostic de véhicules utilitaires et voitures de flotte.",
  "Tu analyses les retours d'utilisation d'UN SEUL véhicule et tu aides une équipe non technique à décider des prochaines maintenances.",
  "Réponds uniquement en français et en JSON valide, sans markdown.",
  "Ne prétends jamais qu'une panne est certaine : distingue les faits signalés et les vérifications recommandées.",
  "Pour chaque anomalie retenue, formule un avis de mécanicien : causes plausibles classées, éléments à contrôler et raisons qui les relient aux symptômes. Reste prudent : un retour utilisateur ne remplace pas un diagnostic atelier.",
  "PÉRIMÈTRE STRICT : ne traite que les anomalies mécaniques, électriques, électroniques, de freinage, de direction, de suspension, de pneus, d'éclairage, de ventilation, de chauffage, de climatisation ou de sécurité qui dégradent le fonctionnement du véhicule.",
  "EXCLUS SANS EXCEPTION : carburant ou plein non fait, propreté, vitres sales, objets laissés, rangement, carnet de bord, kilométrage non renseigné, marquage, flocage, organisation, réservations, système audio/de confort non essentiel et tout sujet administratif ou de gestion. Ne les résume pas et ne propose jamais de maintenance pour eux.",
  "Ne crée une proposition que si elle est justifiée par une anomalie technique ou de sécurité réellement signalée dans les retours.",
  "Au maximum 5 propositions, concrètes et actionnables. Une priorité vaut low, medium ou high.",
  "S'il n'y a aucune anomalie technique ou de sécurité à retenir, réponds avec une synthèse vide et aucune proposition. N'écris pas de message du type « tout va bien ».",
  "La valeur diagnosis doit respecter exactement cette présentation Markdown courte : **Constat** puis une phrase, **Causes plausibles** puis des puces commençant par - , **Contrôles à réaliser** puis des puces, **Prudence** puis une phrase. Chaque section est sur sa propre ligne. Utilise le gras uniquement pour ces titres, sans paragraphe compact ni numérotation.",
  'Format strict : {"summary":"... ou vide","diagnosis":"**Constat**\\n...\\n\\n**Causes plausibles**\\n- ...\\n\\n**Contrôles à réaliser**\\n- ...\\n\\n**Prudence**\\n... ou vide","proposals":[{"title":"...","description":"...","priority":"low|medium|high"}]}',
].join("\n");

/** Données métiers bornées, accessibles uniquement à l'action IA interne. */
export const snapshot = internalQuery({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, { vehicleId }): Promise<RemarkSnapshot | null> => {
    const vehicle = await ctx.db.get(vehicleId);
    if (!vehicle) return null;
    const reservations = await ctx.db
      .query("vehicleReservations")
      .withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicleId))
      .order("desc")
      .take(100);
    const remarks = reservations
      .filter((reservation) => reservation.feedbackSubmittedAt)
      .sort((a, b) => (b.feedbackSubmittedAt ?? 0) - (a.feedbackSubmittedAt ?? 0))
      .map((reservation) => ({
        submittedAt: reservation.feedbackSubmittedAt ?? reservation._creationTime,
        userName: reservation.userName,
        purpose: reservation.purpose,
        mileage: reservation.feedbackMileage,
        fuelRestored: reservation.feedbackFuelRestored,
        vehicleEmpty: reservation.feedbackVehicleEmpty,
        vehicleClean: reservation.feedbackVehicleClean,
        issues: reservation.feedbackIssues,
        notes: reservation.feedbackNotes,
      }));
    return {
      vehicle: {
        name: vehicle.name,
        plate: vehicle.plate,
        brand: vehicle.brand,
        model: vehicle.model,
        odometerKm: vehicle.odometerKm,
      },
      remarks,
    };
  },
});

/** Enregistre une analyse seulement si elle couvre au moins les derniers retours connus. */
export const save = internalMutation({
  args: {
    vehicleId: v.id("vehicles"),
    summary: v.string(),
    diagnosis: v.optional(v.string()),
    proposals: v.array(v.object({ title: v.string(), description: v.string(), priority })),
    sourceRemarkCount: v.number(),
    latestRemarkAt: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("vehicleRemarkAnalyses")
      .withIndex("by_vehicleId", (q) => q.eq("vehicleId", args.vehicleId))
      .unique();
    if (existing && existing.latestRemarkAt > args.latestRemarkAt) return;
    const payload = { ...args, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("vehicleRemarkAnalyses", payload);
    }
  },
});

/** Retire une ancienne analyse lorsque les retours ne remontent aucun sujet technique. */
export const clear = internalMutation({
  args: { vehicleId: v.id("vehicles"), latestRemarkAt: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("vehicleRemarkAnalyses")
      .withIndex("by_vehicleId", (q) => q.eq("vehicleId", args.vehicleId))
      .unique();
    if (existing && existing.latestRemarkAt <= args.latestRemarkAt) await ctx.db.delete(existing._id);
  },
});

/** Lance OpenAI après chaque retour véhicule ; la synthèse inclut tous ses retours. */
export const analyze = internalAction({
  args: { vehicleId: v.id("vehicles") },
  handler: async (ctx, { vehicleId }) => {
    const snapshot: RemarkSnapshot | null = await ctx.runQuery(internal.vehicleRemarkAnalysis.snapshot, { vehicleId });
    if (!snapshot || snapshot.remarks.length === 0) return null;
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Clé OpenAI non configurée pour l'analyse des retours véhicules.");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: env.OPENAI_REQUEST_ANALYSIS_MODEL?.trim() || "gpt-4o",
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: ANALYST_INSTRUCTIONS },
          { role: "user", content: JSON.stringify(snapshot) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI n'a pas pu analyser les retours (${response.status}).`);
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? "";
    let parsed: { summary?: unknown; diagnosis?: unknown; proposals?: unknown };
    try {
      parsed = JSON.parse(raw) as { summary?: unknown; diagnosis?: unknown; proposals?: unknown };
    } catch {
      throw new Error("OpenAI a renvoyé une analyse illisible.");
    }
    const priorityValues = new Set(["low", "medium", "high"]);
    const proposals = Array.isArray(parsed.proposals)
      ? parsed.proposals.slice(0, 5).flatMap((proposal) => {
          if (!proposal || typeof proposal !== "object") return [];
          const value = proposal as { title?: unknown; description?: unknown; priority?: unknown };
          const title = typeof value.title === "string" ? value.title.trim().slice(0, 140) : "";
          const description = typeof value.description === "string" ? value.description.trim().slice(0, 600) : "";
          if (!title || !description) return [];
          return [{ title, description, priority: priorityValues.has(value.priority as string) ? value.priority as "low" | "medium" | "high" : "medium" }];
        })
      : [];
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 2000) : "";
    const diagnosis = typeof parsed.diagnosis === "string" ? parsed.diagnosis.trim().slice(0, 2200) : "";
    if (!summary && proposals.length === 0) {
      await ctx.runMutation(internal.vehicleRemarkAnalysis.clear, {
        vehicleId,
        latestRemarkAt: snapshot.remarks[0].submittedAt,
      });
      return null;
    }
    if (!summary) throw new Error("OpenAI n'a pas fourni de synthèse exploitable.");
    await ctx.runMutation(internal.vehicleRemarkAnalysis.save, {
      vehicleId,
      summary,
      diagnosis: diagnosis || undefined,
      proposals,
      sourceRemarkCount: snapshot.remarks.length,
      latestRemarkAt: snapshot.remarks[0].submittedAt,
      model: env.OPENAI_REQUEST_ANALYSIS_MODEL?.trim() || "gpt-4o",
    });
    return null;
  },
});

/** Relance explicitement les analyses existantes ; réservé aux gestionnaires flotte. */
export const rerunExisting = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "manage");
    const reservations = await ctx.db.query("vehicleReservations").order("desc").take(300);
    const vehicleIds = Array.from(
      new Set(
        reservations
          .filter((reservation) => reservation.feedbackSubmittedAt)
          .map((reservation) => reservation.vehicleId),
      ),
    );
    for (const [index, vehicleId] of vehicleIds.entries()) {
      await ctx.scheduler.runAfter(index * 750, internal.vehicleRemarkAnalysis.analyze, { vehicleId });
    }
    return { scheduled: vehicleIds.length };
  },
});

/** Synthèse affichée au-dessus des retours, globalement ou pour un véhicule précis. */
export const list = query({
  args: { vehicleId: v.optional(v.id("vehicles")) },
  handler: async (ctx, { vehicleId }) => {
    await requireCrmPermission(ctx, FLEET_PAGE_KEY, "read");
    if (vehicleId) {
      const analysis = await ctx.db
        .query("vehicleRemarkAnalyses")
        .withIndex("by_vehicleId", (q) => q.eq("vehicleId", vehicleId))
        .unique();
      const vehicle = await ctx.db.get(vehicleId);
      return analysis ? [{
        ...analysis,
        vehicleName: vehicle?.name ?? "Véhicule",
        vehiclePhotoUrl: vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle?.photoUrl ?? null,
      }] : [];
    }
    const analyses = await ctx.db.query("vehicleRemarkAnalyses").order("desc").take(100);
    return await Promise.all(
      analyses.map(async (analysis) => {
        const vehicle = await ctx.db.get(analysis.vehicleId);
        return {
          ...analysis,
          vehicleName: vehicle?.name ?? "Véhicule",
          vehiclePhotoUrl: vehicle?.photo ? await ctx.storage.getUrl(vehicle.photo) : vehicle?.photoUrl ?? null,
        };
      }),
    );
  },
});
