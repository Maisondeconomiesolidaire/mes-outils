/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture() {
  vi.useFakeTimers(); vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => Promise.all(["Bois", "Plâtre"].map(title => ctx.db.insert("btMaterials", { title, description: title, category: "Menuiserie", condition: "bon_etat", unit: "unite", quantity: 20, price: 10, depot: "Comptoir C", photos: [], status: "disponible", createdAt: 1, updatedAt: 1 }))));
  const client = t.withIdentity({ subject: "client", email: "client@example.com" });
  const admin = t.withIdentity({ subject: "admin", email: "admin@example.com" });
  const customer = { firstName: "Jean", lastName: "Test", email: "client@example.com" };
  const items = ids.map(materialId => ({ materialId, quantity: 2, pickupLocation: "recyclerie_pays_de_bray" as const }));
  return { t, client, admin, customer, items };
}

test("payment methods are authorized by the saved customer type on the server", async () => {
  const { t, client, customer, items } = await fixture();
  await expect(client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "cash" })).rejects.toThrow();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "professionnel" });
  await expect(client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "bank_transfer" })).rejects.toThrow();
  const result = await client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "cash" });
  const rows = await t.run(ctx => ctx.db.query("btOrders").collect());
  expect(rows.map(row => row.purchaseReference)).toEqual([result.reference, result.reference]);
  expect(rows.every(row => row.paymentMethod === "cash" && row.status === "reservee")).toBe(true);
  expect(rows.reduce((sum, row) => sum + (row.pickupFeeCents ?? 0), 0)).toBe(3500);
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(2);
  await expect(client.mutation(api.batire.confirmOfflinePayment, { orderId: rows[0]._id })).rejects.toThrow();
});

test("bank transfer stays unpaid until staff confirmation and then creates its transfer", async () => {
  const { t, client, admin, customer, items } = await fixture();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "collectivite" });
  await client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "bank_transfer" });
  const rows = await t.run(ctx => ctx.db.query("btOrders").collect());
  expect(rows.every(row => row.status === "en_attente")).toBe(true);
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(0);
  await admin.mutation(api.batire.confirmOfflinePayment, { orderId: rows[0]._id });
  expect((await t.run(ctx => ctx.db.get(rows[0]._id)))?.status).toBe("payee");
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(1);
  await expect(admin.mutation(api.batire.confirmOfflinePayment, { orderId: rows[0]._id })).rejects.toThrow();
});

test("cash cannot be handed over before payment confirmation", async () => {
  const { t, client, admin, customer, items } = await fixture();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "professionnel" });
  await client.mutation(api.batire.requestOfflineCart, { customer, items: [{ ...items[0], pickupLocation: "comptoir_c" }], paymentMethod: "cash" });
  const order = (await t.run(ctx => ctx.db.query("btOrders").collect()))[0];
  await admin.mutation(api.batire.updatePickup, { orderId: order._id, step: "ready", pickupHours: "9h–17h" });
  await expect(admin.mutation(api.batire.updatePickup, { orderId: order._id, step: "collect" })).rejects.toThrow();
  await admin.mutation(api.batire.confirmOfflinePayment, { orderId: order._id });
  await admin.mutation(api.batire.updatePickup, { orderId: order._id, step: "collect" });
  expect((await t.run(ctx => ctx.db.get(order._id)))?.collectedAt).toBeDefined();
});
