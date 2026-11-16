import { describe, expect, it } from "vitest";
import { isBillingExemptCompany } from "./lib/bpBillingExempt";

describe("isBillingExemptCompany", () => {
  it("rend gratuits les dépôts de Matériosol (SIRET ou nom)", () => {
    expect(isBillingExemptCompany({ name: "MATERIOSOL", siret: "92100552600014" })).toBe(true);
    expect(isBillingExemptCompany({ name: "Autre nom", siret: "921 005 526 00014" })).toBe(true);
    expect(isBillingExemptCompany({ name: "Matériosol" })).toBe(true);
  });

  it("continue de facturer les autres entreprises", () => {
    expect(isBillingExemptCompany({ name: "Matériosol Services BTP", siret: "12345678900011" })).toBe(false);
    expect(isBillingExemptCompany({ name: "Durand Bâtiment" })).toBe(false);
    expect(isBillingExemptCompany(null)).toBe(false);
  });
});
