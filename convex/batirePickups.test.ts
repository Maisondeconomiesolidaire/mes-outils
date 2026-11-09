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
  // Les transits ne sont plus créés au paiement : l'équipe Bâtire crée la demande d'enlèvement.
  const relay = async () => { for (const order of orders.slice(1)) await admin.mutation(api.batire.requestPickupTransfer, { orderId: order.orderId, dueDate: "2026-11-20" }); };
  return { t, admin, client, orders, materials, pay, relay };
}

test("one purchase, separate pickups, immutable depot snapshots and one 35 euro fee", async () => {
  const { t, orders, materials, pay, relay, admin, client } = await fixture();
  const rows = await t.run(ctx => ctx.db.query("btOrders").collect());
  expect(new Set(rows.map(row => row.purchaseReference)).size).toBe(1);
  expect(rows.map(row => row.pickupReference)).toEqual(["BT00001-A", "BT00001-B", "BT00001-C"]);
  expect(orders.reduce((sum, order) => sum + order.pickupFeeCents, 0)).toBe(3500);
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(0);
  await t.run(ctx => ctx.db.patch(materials[1], { depot: "Esspace 150" }));
  await pay(); await pay();
  expect(await admin.query(api.meslogistic.list, {})).toHaveLength(0);
  const pending = (await admin.query(api.batire.pickupOperations, {})).orders;
  expect(pending.filter(row => row.relayRequested)).toHaveLength(2);
  await relay();
  const transfers = await admin.query(api.meslogistic.list, {});
  expect(transfers).toHaveLength(2);
  expect(transfers.every(row => row.origin === "Comptoir C")).toBe(true);
  const operationRows = (await admin.query(api.batire.pickupOperations, {})).orders;
  expect(operationRows).toHaveLength(3);
  expect(operationRows.find(row => row._id === orders[0].orderId)?.fulfillment.status).toBe("preparing");
  expect(operationRows.filter(row => row.fulfillment.status === "waiting")).toHaveLength(2);
  expect((await client.query(api.batire.myOrderActivity, {})).orders).toHaveLength(3);
  expect((await t.withIdentity({ subject: "other", email: "other@example.com" }).query(api.batire.myOrderActivity, {})).orders).toHaveLength(0);
});

test("shared shuttle and partial reception do not block other pickups; ready notification is idempotent", async () => {
  const { t, admin, client, orders, pay, relay } = await fixture(); await pay(); await relay();
  const shuttleId = await admin.mutation(api.batire.createPickupShuttle, { name: "Navette 12 novembre", scheduledDate: "2026-11-12" });
  const transfer = async (index: number) => (await admin.query(api.meslogistic.list, {})).find(row => row.orderId === orders[index].orderId)!;
  for (const index of [1, 2]) {
    await admin.mutation(api.batire.updatePickup, { orderId: orders[index].orderId, step: "assign", shuttleId, expectedTransferUpdatedAt: (await transfer(index)).updatedAt });
    await admin.mutation(api.batire.updatePickup, { orderId: orders[index].orderId, step: "depart", expectedTransferUpdatedAt: (await transfer(index)).updatedAt });
  }
  const stale = (await transfer(1)).updatedAt;
  await admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "receive", receivedQuantity: 1, expectedTransferUpdatedAt: stale });
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "receive", receivedQuantity: 2, expectedTransferUpdatedAt: stale })).rejects.toThrow();
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "ready", availableFrom: "2026-11-21" })).rejects.toThrow();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "receive", receivedQuantity: 2, expectedTransferUpdatedAt: (await transfer(2)).updatedAt });
  expect((await admin.query(api.batire.pickupOperations, {})).orders).toHaveLength(3);
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "collect" })).rejects.toThrow();
  const scheduledBefore = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "ready", availableFrom: "2026-11-21" });
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "ready", availableFrom: "2026-11-21" });
  // « Disponible » n'envoie aucun email : seule la notification explicite prévient le client.
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(scheduledBefore.length);
  expect((await client.query(api.batire.myOrderActivity, {})).orders.find(row => row._id === orders[2].orderId)?.fulfillment.status).not.toBe("ready");
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "notify" })).rejects.toThrow();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[2].orderId, step: "notify", pickupHours: "9h–17h" });
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(scheduledBefore.length + 1);
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
  await expect(logistics.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready", availableFrom: "2026-11-21" })).rejects.toThrow();
  expect((await batire.query(api.batire.pickupOperations, {})).orders).toHaveLength(3);
});

test("one shuttle can carry transfers from different purchases; an all-local purchase is free", async () => {
  const { t, admin, orders, materials, pay, relay } = await fixture(); await pay(); await relay();
  const local = await t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items: materials.map(materialId => ({ materialId, quantity: 1, pickupLocation: "comptoir_c" as const })) });
  expect(local.every(order => order.pickupFeeCents === 0)).toBe(true);
  const second = await t.mutation(internal.batire.createCartOrders, { customer, userId: "client", items: [{ materialId: materials[0], quantity: 1, pickupLocation: "esspace_150" }] });
  await t.mutation(internal.batire.markOrderPaid, { orderId: second[0].orderId });
  await admin.mutation(api.batire.requestPickupTransfer, { orderId: second[0].orderId, dueDate: "2026-11-20" });
  const shuttleId = await admin.mutation(api.batire.createPickupShuttle, { name: "Tournée commune", scheduledDate: "2026-11-12" });
  for (const orderId of [orders[1].orderId, second[0].orderId]) {
    const transfer = (await admin.query(api.meslogistic.list, {})).find(row => row.orderId === orderId)!;
    await admin.mutation(api.batire.updatePickup, { orderId, step: "assign", shuttleId, expectedTransferUpdatedAt: transfer.updatedAt });
  }
  expect((await admin.query(api.meslogistic.list, {})).filter(row => row.shuttleId === shuttleId)).toHaveLength(2);
  const row = await t.run(ctx => ctx.db.get(second[0].orderId));
  expect(row?.purchaseReference).not.toBe((await t.run(ctx => ctx.db.get(orders[0].orderId)))?.purchaseReference);
});

test("same-site pickup: availability without hours, or conversion into a Meslogistic transit with a due date", async () => {
  const { t, admin, orders, pay } = await fixture(); await pay();
  // orders[0] : stocké et retiré au Comptoir C → aucun transit.
  expect((await admin.query(api.batire.pickupOperations, {})).orders.find(row => row._id === orders[0].orderId)?.transfer).toBeNull();
  await expect(admin.mutation(api.batire.requestPickupTransfer, { orderId: orders[0].orderId, destination: "comptoir_c", dueDate: "2026-11-20" })).rejects.toThrow();
  await expect(admin.mutation(api.batire.requestPickupTransfer, { orderId: orders[0].orderId, destination: "esspace_150", dueDate: "20/11/2026" })).rejects.toThrow();
  await admin.mutation(api.batire.requestPickupTransfer, { orderId: orders[0].orderId, destination: "esspace_150", dueDate: "2026-11-20" });
  const row = (await admin.query(api.batire.pickupOperations, {})).orders.find(line => line._id === orders[0].orderId)!;
  expect(row.pickupLocation).toBe("esspace_150");
  expect(row.transfer).toMatchObject({ origin: "Comptoir C", destination: "Esspace 150 / Recyclerie de Gournay", dueDate: "2026-11-20", status: "a_preparer" });
  expect((await admin.query(api.meslogistic.list, {})).filter(transfer => transfer.orderId === orders[0].orderId)).toHaveLength(1);
  await expect(admin.mutation(api.batire.requestPickupTransfer, { orderId: orders[0].orderId, destination: "recyclerie_pays_de_bray", dueDate: "2026-11-20" })).rejects.toThrow();
  // Un transit exige toujours une date/heure : le lot n'est pas encore arrivé.
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready" })).rejects.toThrow();
  await t.run(async ctx => {
    const transfer = await ctx.db.query("mlRequests").withIndex("by_orderId", q => q.eq("orderId", orders[0].orderId)).first();
    await ctx.db.patch(transfer!._id, { status: "receptionnee" });
  });
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready" })).rejects.toThrow();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready", availableFrom: "2026-11-21" });
  expect((await t.run(ctx => ctx.db.get(orders[0].orderId)))?.availableFrom).toBe("2026-11-21");
});

test("a lost pickup leaves the open board, cancels its pending transit and can restock a paid order", async () => {
  const { t, admin, orders, materials, pay, relay } = await fixture(); await pay(); await relay();
  const before = (await t.run(ctx => ctx.db.get(materials[1])))!.quantity;
  await expect(admin.mutation(api.batire.markPickupLost, { orderId: orders[1].orderId, reason: " ", restock: true })).rejects.toThrow();
  await admin.mutation(api.batire.markPickupLost, { orderId: orders[1].orderId, reason: "Client injoignable", restock: true });
  await admin.mutation(api.batire.markPickupLost, { orderId: orders[1].orderId, reason: "Client injoignable", restock: true });
  expect((await t.run(ctx => ctx.db.get(materials[1])))!.quantity).toBe(before + 2);
  const transfer = (await admin.query(api.meslogistic.list, {})).find(row => row.orderId === orders[1].orderId)!;
  expect(transfer.status).toBe("annulee");
  expect((await admin.query(api.batire.pickupOperations, {})).orders.find(row => row._id === orders[1].orderId)?.lostReason).toBe("Client injoignable");
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[1].orderId, step: "ready", availableFrom: "2026-11-21" })).rejects.toThrow();
});

test("same-site pickup can be declared available without hours", async () => {
  const { t, admin, orders, pay } = await fixture(); await pay();
  await expect(admin.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready" })).rejects.toThrow();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "ready", availableFrom: "2026-11-21" });
  const order = await t.run(ctx => ctx.db.get(orders[0].orderId));
  expect(order?.readyAt).toBeDefined();
  expect(order?.customerNotifiedAt).toBeUndefined();
  await admin.mutation(api.batire.updatePickup, { orderId: orders[0].orderId, step: "notify", pickupHours: "Du mardi au samedi, 14h – 17h" });
  expect((await t.run(ctx => ctx.db.get(orders[0].orderId)))?.customerNotifiedAt).toBeDefined();
});
