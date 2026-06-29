import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin, requireCrmPermission } from "./lib";
import { STEP } from "./processes";
import { Doc } from "./_generated/dataModel";

const REQUEST_TYPE = v.union(
  v.literal("aerogommage"),
  v.literal("collecte"),
  v.literal("article"),
  v.literal("velo"),
);

/** Colonne Kanban déduite de l'avancement du process. */
function deriveStage(r: Doc<"requests">): "nouveau" | "validation" | "planifie" {
  const completed = r.completedSteps ?? 0;
  if (completed === 0) return "nouveau";
  const done = (r.processSteps ?? []).slice(0, completed);
  if (done.includes(STEP.prestaPlanifiee)) return "planifie";
  return "validation";
}

/** Statistiques agrégées pour le tableau de bord du CRM. */
export const stats = query({
  args: { type: v.optional(REQUEST_TYPE) },
  handler: async (ctx, { type }) => {
    await requireCrmPermission(ctx, "dashboard", "read");
    const all = await ctx.db.query("requests").collect();
    const requests = type ? all.filter((r) => r.type === type) : all;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const byType = { aerogommage: 0, collecte: 0, article: 0, velo: 0, livraison: 0 };
    const byStage = { nouveau: 0, validation: 0, planifie: 0 };
    let open = 0;
    let won = 0;
    let lost = 0;
    let incomplete = 0;
    let scheduledToday = 0;

    for (const r of all) {
      byType[r.type]++;
    }

    for (const r of requests) {
      if (r.outcome === "open") {
        open++;
        byStage[deriveStage(r)]++;
        if (!r.complete) incomplete++;
      } else if (r.outcome === "gagnee") {
        won++;
      } else {
        lost++;
      }
      if (
        r.scheduledDate &&
        r.scheduledDate >= startOfDay.getTime() &&
        r.scheduledDate <= endOfDay.getTime()
      ) {
        scheduledToday++;
      }
    }

    return {
      total: requests.length,
      open,
      won,
      lost,
      incomplete,
      scheduledToday,
      byType,
      byStage,
    };
  },
});

/**
 * Vue « maison mère » : agrégat du chiffre d'affaires et de l'activité de
 * toutes les applications (Recyclerie, Klyde, Cycle en Bray). Réservé aux
 * administrateurs. Parcourt les tables en entier (acceptable : usage admin,
 * faible fréquence) — à dénormaliser via compteurs si le volume explose.
 */
export const globalStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const [requests, ventes, klydeOrders, klydeItems, bikes, cycleRequests] =
      await Promise.all([
        ctx.db.query("requests").collect(),
        ctx.db.query("ventes").collect(),
        ctx.db.query("klydeOrders").collect(),
        ctx.db.query("klydeItems").collect(),
        ctx.db.query("bikes").collect(),
        ctx.db.query("cycleRequests").collect(),
      ]);

    // — Recyclerie : collecte + aérogommage (devis gagnés) + boutique (caisse) —
    const recyclerieSegment = (type: "collecte" | "aerogommage") => {
      const items = requests.filter((request) => request.type === type);
      const won = items.filter((request) => request.outcome === "gagnee");
      return {
        requests: items.length,
        open: items.filter((request) => request.outcome === "open").length,
        won: won.length,
        revenue: won.reduce((sum, request) => sum + (request.quoteAmount ?? 0), 0),
      };
    };
    const collecte = recyclerieSegment("collecte");
    const aerogommage = recyclerieSegment("aerogommage");
    const boutique = {
      revenue: ventes.reduce((sum, vente) => sum + vente.total, 0),
      sales: ventes.length,
    };
    const recyclerieRevenue = collecte.revenue + aerogommage.revenue + boutique.revenue;

    // — Klyde : commandes boutique payées —
    const paidKlyde = klydeOrders.filter((order) => order.status === "payee");
    const klyde = {
      revenue: paidKlyde.reduce((sum, order) => sum + order.total, 0),
      orders: klydeOrders.length,
      paidOrders: paidKlyde.length,
      pendingOrders: klydeOrders.length - paidKlyde.length,
      items: klydeItems.length,
    };

    // — Cycle en Bray : vélos vendus + pipeline des demandes —
    const cycleOpenStatuses = ["nouveau", "validation", "en_cours"];
    const soldBikes = bikes.filter((bike) => bike.status === "sold");
    const cycle = {
      revenue: soldBikes.reduce((sum, bike) => sum + (bike.price ?? 0), 0),
      requests: cycleRequests.length,
      open: cycleRequests.filter((request) => cycleOpenStatuses.includes(request.pipelineStatus)).length,
      won: cycleRequests.filter((request) => request.pipelineStatus === "gagnee").length,
      bikes: bikes.length,
      bikesSold: soldBikes.length,
      bikesAvailable: bikes.filter((bike) =>
        ["available", "online", "ready"].includes(bike.status),
      ).length,
    };

    return {
      totalRevenue: recyclerieRevenue + klyde.revenue + cycle.revenue,
      recyclerie: {
        revenue: recyclerieRevenue,
        requests: requests.length,
        open: requests.filter((request) => request.outcome === "open").length,
        collecte,
        aerogommage,
        boutique,
      },
      klyde,
      cycle,
    };
  },
});
