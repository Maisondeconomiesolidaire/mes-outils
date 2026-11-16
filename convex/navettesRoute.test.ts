import { describe, expect, it } from "vitest";
import { isOnRoute, parisDay, roundTripKm, transitOnRoute } from "./lib/navettesRoute";

describe("navettes : sites et transits sur la route", () => {
  it("le Solidarium est toujours sur la route (départ et retour)", () => {
    expect(transitOnRoute({ origin: "Comptoir C", destination: "Recyclerie du Pays de Bray" }, ["comptoir_c"])).toBe(true);
    expect(transitOnRoute({ origin: "Recyclerie du Pays de Bray", destination: "Esspace 150 / Recyclerie de Gournay" }, ["esspace_150"])).toBe(true);
  });

  it("refuse un transit dont un lieu n'est pas sur la route", () => {
    expect(transitOnRoute({ origin: "Recyclerie du Pays de Bray", destination: "Esspace 150 / Recyclerie de Gournay" }, ["comptoir_c"])).toBe(false);
    expect(transitOnRoute({ origin: "Lieu de départ à préciser", destination: "Comptoir C" }, ["comptoir_c"])).toBe(false);
  });

  it("accepte Beauvais → Gournay si les deux sont sur la route", () => {
    expect(transitOnRoute({ origin: "Comptoir C", destination: "Esspace 150" }, ["comptoir_c", "esspace_150"])).toBe(true);
  });

  it("tolère un petit détour, pas un grand", () => {
    expect(isOnRoute(3, 15)).toBe(true);
    expect(isOnRoute(30, 15)).toBe(false);
    expect(isOnRoute(20, 200)).toBe(true);
  });

  it("calcule l'aller-retour et la date de Paris", () => {
    expect(roundTripKm(15.4)).toBe(31);
    expect(parisDay(Date.UTC(2026, 10, 16, 23, 30))).toBe("2026-11-17");
  });
});
