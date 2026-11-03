/** Calendar month in the business timezone, including UTC month boundaries. */
export function billingMonth(timestamp: number): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit",
  }).formatToParts(timestamp);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

export function aggregateBillingLines<T extends { material: string; weightKg: number; amountCents: number; priceCentsPerKg: number }>(lines: T[]): T[] {
  const totals = new Map<string, T>();
  for (const line of lines) {
    const old = totals.get(line.material);
    if (old) {
      old.weightKg += line.weightKg;
      old.amountCents += line.amountCents;
      old.priceCentsPerKg = old.amountCents / old.weightKg;
    } else totals.set(line.material, { ...line });
  }
  return [...totals.values()];
}
