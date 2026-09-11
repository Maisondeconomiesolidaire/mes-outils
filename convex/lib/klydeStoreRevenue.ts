/** Annual totals are authoritative for their site; weekly details are not added twice.
 * Monthly reports always use actual dated entries, never an annual allocation.
 */
export function summarizeStoreRevenue(
  entries: ReadonlyArray<{ site: "60" | "76"; amount: number }>,
  annualTotals: ReadonlyArray<{ site: "60" | "76"; amount: number }>,
  month: number | null,
) {
  const bySite = { "60": 0, "76": 0 };
  for (const entry of entries) bySite[entry.site] += entry.amount;
  if (month === null) {
    for (const annual of annualTotals) bySite[annual.site] = annual.amount;
  }
  bySite["60"] = Math.round(bySite["60"] * 100) / 100;
  bySite["76"] = Math.round(bySite["76"] * 100) / 100;
  return { bySite, revenue: Math.round((bySite["60"] + bySite["76"]) * 100) / 100 };
}
