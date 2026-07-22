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
  "Tu es le responsable maintenance d'une flotte solidaire.",
  "Tu analyses les retours d'utilisation d'UN SEUL véhicule et tu aides une équipe non technique à décider des prochaines maintenances.",
  "Réponds uniquement en français et en JSON valide, sans markdown.",
  "Ne prétends jamais qu'une panne est certaine : distingue les faits signalés et les vérifications recommandées.",
  "Ne crée une proposition que si elle est justifiée par les retours ou un contrôle prudent utile.",
  "Au maximum 5 propositions, concrètes et actionnables. Une priorité vaut low, medium ou high.",
  "Le résumé doit être bref, opérationnel et faire apparaître les problèmes récurrents, ou indiquer explicitement qu'aucune anomalie n'est signalée.",
  'Format strict : {"summary":"...","proposals":[{"title":"...","description":"...","priority":"low|medium|high"}]}',
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
    let parsed: { summary?: unknown; proposals?: unknown };
    try {
      parsed = JSON.parse(raw) as { summary?: unknown; proposals?: unknown };
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
    if (!summary) throw new Error("OpenAI n'a pas fourni de synthèse exploitable.");
    await ctx.runMutation(internal.vehicleRemarkAnalysis.save, {
      vehicleId,
      summary,
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
      return analysis ? [{ ...analysis, vehicleName: vehicle?.name ?? "Véhicule" }] : [];
    }
    const analyses = await ctx.db.query("vehicleRemarkAnalyses").order("desc").take(100);
    return await Promise.all(
      analyses.map(async (analysis) => ({
        ...analysis,
        vehicleName: (await ctx.db.get(analysis.vehicleId))?.name ?? "Véhicule",
      })),
    );
  },
});
