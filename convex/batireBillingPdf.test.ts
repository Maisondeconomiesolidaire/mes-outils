import { expect, test } from "vitest";
import { buildBillingPdf } from "./lib/batireBillingPdf";

test("our invoice PDF builds on the server (automatic e-mail after card payment)", async () => {
  const bytes = await buildBillingPdf({
    type: "facture", issuer: "materiosol", number: "MAT-F-2026-0001", issueDate: "2026-11-20", dueDate: "2026-11-20",
    client: { firstName: "Jean", lastName: "Test", email: "client@example.com", address: "1 rue du Test", postalCode: "60000", city: "Beauvais" },
    lines: [{ label: "Plaques de plâtre", quantity: 2, unit: "unité", unitPriceCents: 1200 }, { label: "Remise · code TEST", quantity: 1, unitPriceCents: -400 }],
    vatRate: 20, totalCents: 2000, status: "payee", paidAt: Date.now(), paymentMethod: "Carte bancaire",
  });
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1500);
});
