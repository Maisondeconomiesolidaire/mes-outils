import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireCrmPermission } from "./lib";
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
