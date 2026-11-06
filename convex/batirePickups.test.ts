/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");
const customer = { firstName: "Client", lastName: "Test", email: "client@example.com" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function fixture() {
  vi.useFakeTimers(); vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const t = convexTest(schema, modules);
  const materials = await t.run(async ctx => Promise.all(["Plâtre", "OSB", "Porte"].map(title => ctx.db.insert("btMaterials", {
    title, description: title, category: "Menuiserie", condition: "bon_etat", unit: "unite", quantity: 20, price: 10,
    depot: "Comptoir C", photos: [], status: "disponible", createdAt: 1, updatedAt: 1,
  }))));
  const orders = await t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items: materials.map((materialId, index) => ({ materialId, quantity: 2, pickupLocation: index === 0 ? "comptoir_c" as const : "recyclerie_pays_de_bray" as const })) });
  const admin = t.withIdentity({ subject: "admin", email: "admin@example.com" });
  const client = t.withIdentity({ subject: "client", email: customer.email });
  const pay = async () => { for (const order of orders) await t.mutation(internal.batire.markOrderPaid, { orderId: order.orderId }); };
  return { t, admin, client, orders, materials, pay };
}

test("one purchase, separate pickups, immutable depot snapshots and one 35 euro fee", async () => {
  const { t, orders, materials, pay, admin, client } = await fixture();
  const rows = await t.run(ctx => ctx.db.query("btOrders").collect());
  expect(new Set(rows.map(row => row.purchaseReference)).size).toBe(1);
  expect(rows.map(row => row.pickupReference)).toEqual(["BT00001-A", "BT00001-B", "BT00001-C"]);
  expect(orders.reduce((sum, order) => sum + order.pickupFeeCents, 0)).toBe(3500);
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(0);
  await t.run(ctx => ctx.db.patch(materials[1], { depot: "Esspace 150" }));
  await pay(); await pay();
  const transfers = await admin.query(api.meslogistic.list, {});
  expect(transfers).toHaveLength(2);
  expect(transfers.every(row => row.origin === "Comptoir C")).toBe(true);
  expect((await admin.query(api.batire.pickupOperations, {})).orders.map(row => row._id)).toEqual([orders[0].orderId]);
  expect((await client.query(api.batire.myOrderActivity, {})).orders).toHaveLength(3);
  expect((await t.withIdentity({ subject: "other", email: "other@example.com" }).query(api.batire.myOrderActivity, {})).orders).toHaveLength(0);
});

test("shared shuttle and partial reception do not block other pickups; ready notification is idempotent", async () => {
  const { t, admin, client, orders, pay } = await fixture(); await pay();
  const shuttleId = await admin.mutation(api.batire.createPickupShuttle, { name: "Navette 12 novembre", scheduledDate: "2026-11-12" });
  const transfer = async (index: number) => (await admin.query(api.meslogistic.list, {})).find(row => row.orderId === orders[index].orderId)!;
  for (const index of [1, 2]) {
    await admin.mutation(api.batire.updatePickup, { orderId: orders[index].orderId, step: "assign", shuttleId, expectedTransferUpdatedAt: (await transfer(index)).updatedAt });
    await admin.mutation(api.batire.updatePickup, { orderId: orders[index].orderId, step: "depart", expectedTransferUpdatedAt: (await transfer(index)).updatedAt });
  }
  const stale = (await transfer(1)).updatedAt;
  await admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "receive", receivedQuantity: 1, expectedTransferUpdatedAt: stale });
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "receive", receivedQuantity: 2, expectedTransferUpdatedAt: stale })).rejects.toThrow();
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "ready", pickupHours: "9h–17h" })).rejects.toThrow();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "receive", receivedQuantity: 2, expectedTransferUpdatedAt: (await transfer(2)).updatedAt });
  expect((await admin.query(api.batire.pickupOperations, {})).orders).toHaveLength(2);
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "collect" })).rejects.toThrow();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "ready", pickupHours: "9h–17h" });
  const scheduledBefore = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "ready", pickupHours: "9h–17h" });
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(scheduledBefore.length);
  const activity = await client.query(api.batire.myOrderActivity, {});
  expect(activity.orders.find(row => row._id === orders[1].orderId)?.fulfillment.status).toBe("transit");
  expect(activity.orders.find(row => row._id === orders[2].orderId)?.fulfillment.status).toBe("ready");
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "collect" });
  expect((await client.query(api.batire.myOrderActivity, {})).orders.find(row => row._id === orders[2].orderId)?.fulfillment.status).toBe("collected");
});

test("cart snapshot rolls back on invalid stock, duplicates or unknown depot", async () => {
  const { t, materials } = await fixture();
  for (const items of [
    [{ materialId: materials[0], quantity: 1, pickupLocation: "comptoir_c" as const }, { materialId: materials[1], quantity: 100, pickupLocation: "comptoir_c" as const }],
    [{ materialId: materials[0], quantity: 1, pickupLocation: "comptoir_c" as const }, { materialId: materials[0], quantity: 1, pickupLocation: "comptoir_c" as const }],
  ]) await expect(t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items })).rejects.toThrow();
  await t.run(ctx => ctx.db.patch(materials[0], { depot: "Inconnu" }));
  await expect(t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items: [{ materialId: materials[0], quantity: 1, pickupLocation: "comptoir_c" }] })).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.query("btOrders").collect())).toHaveLength(3);
});

test("Batire operators cannot manage transfers; logistics operators cannot mark pickups ready", async () => {
  const { t, orders, pay } = await fixture(); await pay();
  await t.run(async ctx => {
    for (const app of ["batire", "meslogistic"]) await ctx.db.insert("crmPermissions", { email: `${app}@example.com`, role: "staff", active: true, grants: [{ pageKey: `${app}:demandes`, actions: ["read", "update"] }], createdAt: 1, updatedAt: 1, updatedBy: "test" });
  });
  const batire = t.withIdentity({ subject: "batire", email: "batire@example.com" });
  const logistics = t.withIdentity({ subject: "meslogistic", email: "meslogistic@example.com" });
  await expect(batire.query(api.meslogistic.list, {})).rejects.toThrow();
  await expect(batire.mutation(api.batire.createPickupShuttle, { name: "Navette", scheduledDate: "2026-11-12" })).rejects.toThrow();
  await expect(batire.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "depart" })).rejects.toThrow();
  await expect(logistics.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready", pickupHours: "9h–17h" })).rejects.toThrow();
  expect((await batire.query(api.batire.pickupOperations, {})).orders).toHaveLength(1);
});

test("one shuttle can carry transfers from different purchases; an all-local purchase is free", async () => {
  const { t, admin, orders, materials, pay } = await fixture(); await pay();
  const local = await t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items: materials.map(materialId => ({ materialId, quantity: 1, pickupLocation: "comptoir_c" as const })) });
  expect(local.every(order => order.pickupFeeCents === 0)).toBe(true);
  const second = await t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items: [{ materialId: materials[0], quantity: 1, pickupLocation: "esspace_150" }] });
  await t.mutation(internal.batire.markOrderPaid, { orderId: second[0].orderId });
  const shuttleId = await admin.mutation(api.batire.createPickupShuttle, { name: "Tournée commune", scheduledDate: "2026-11-12" });
  for (const orderId of [orders[1].orderId, second[0].orderId]) {
    const transfer = (await admin.query(api.meslogistic.list, {})).find(row => row.orderId === orderId)!;
    await admin.mutation(api.batire.updatePickup, { orderId, step: "assign", shuttleId, expectedTransferUpdatedAt: transfer.updatedAt });
  }
  expect((await admin.query(api.meslogistic.list, {})).filter(row => row.shuttleId === shuttleId)).toHaveLength(2);
  const row = await t.run(ctx => ctx.db.get(second[0].orderId));
  expect(row?.purchaseReference).not.toBe((await t.run(ctx => ctx.db.get(orders[0].orderId)))?.purchaseReference);
});
