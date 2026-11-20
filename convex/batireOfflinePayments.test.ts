/// <reference types="vite/client" />
import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema";
import { api, internal } from "./_generated/api";

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

test("payment methods: card and cash for everyone, bank transfer for associations and collectivities", async () => {
  const { t, client, customer, items } = await fixture();
  // Particulier : pas de virement, mais les espèces sont ouvertes à tous.
  await expect(client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "bank_transfer" })).rejects.toThrow();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "professionnel" });
  await expect(client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "bank_transfer" })).rejects.toThrow();
  const result = await client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "cash" });
  const rows = await t.run(ctx => ctx.db.query("btOrders").collect());
  expect(rows.map(row => row.purchaseReference)).toEqual([result.reference, result.reference]);
  expect(rows.every(row => row.paymentMethod === "cash" && row.status === "reservee" && row.stockDeducted)).toBe(true);
  // Transfert offert jusqu'au 01/01/2027.
  expect(rows.reduce((sum, row) => sum + (row.pickupFeeCents ?? 0), 0)).toBe(0);
  // Stock décompté dès la réservation.
  const materials = await t.run(ctx => ctx.db.query("btMaterials").collect());
  expect(materials.every(material => material.quantity === 18)).toBe(true);
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(0);
  await expect(client.mutation(api.batire.confirmOfflinePayment, { orderId: rows[0]._id })).rejects.toThrow();
});

test("cart holds stock for 30 minutes, the order takes it over, expiry gives it back", async () => {
  const { t, client, customer, items } = await fixture();
  const holderKey = "holder_abcdefghijklmnop";
  await t.run(async ctx => { for (const item of items) await ctx.db.patch(item.materialId, { published: true }); });
  const [first, second] = items;
  await client.mutation(api.batireCart.setCartItem, { holderKey, materialId: first.materialId, quantity: 5 });
  await client.mutation(api.batireCart.setCartItem, { holderKey, materialId: second.materialId, quantity: 3 });
  const stock = async () => (await t.run(ctx => ctx.db.query("btMaterials").collect())).map(material => material.quantity);
  expect(await stock()).toEqual([15, 17]);
  // Plus que le stock restant : refusé.
  await expect(client.mutation(api.batireCart.setCartItem, { holderKey: "other_abcdefghijklmnop", materialId: first.materialId, quantity: 16 })).rejects.toThrow();
  // La réservation reprend le blocage : pas de second décompte.
  await client.mutation(api.batire.requestOfflineCart, { customer, items: [{ ...first, quantity: 5 }], paymentMethod: "cash", holderKey });
  expect(await stock()).toEqual([15, 17]);
  // Le reste du panier expire au bout de 30 minutes.
  vi.advanceTimersByTime(31 * 60_000);
  await t.finishInProgressScheduledFunctions();
  await t.mutation(internal.batireCart.releaseStaleHolds, {});
  expect(await stock()).toEqual([15, 20]);
  expect(await t.run(ctx => ctx.db.query("btCartHolds").collect())).toHaveLength(0);
});

test("bank transfer can be planned before payment and stays unpaid until staff confirmation", async () => {
  const { t, client, admin, customer, items } = await fixture();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "collectivite" });
  await client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "bank_transfer" });
  const rows = await t.run(ctx => ctx.db.query("btOrders").collect());
  expect(rows.every(row => row.status === "reservee")).toBe(true);
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(0);
  await admin.mutation(api.batire.confirmOfflinePayment, { orderId: rows[0]._id });
  expect((await t.run(ctx => ctx.db.get(rows[0]._id)))?.status).toBe("payee");
  expect(await t.run(ctx => ctx.db.query("mlRequests").collect())).toHaveLength(0);
  await expect(admin.mutation(api.batire.confirmOfflinePayment, { orderId: rows[0]._id })).rejects.toThrow();
});

test("scheduled date is visible to the client before a shuttle is assigned", async () => {
  const { client, admin, customer, items } = await fixture();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "collectivite" });
  await client.mutation(api.batire.requestOfflineCart, { customer, items, paymentMethod: "bank_transfer" });
  const order = (await admin.query(api.batire.pickupOperations, {})).orders[0];
  await admin.mutation(api.batire.requestPickupTransfer, { orderId: order._id, dueDate: "2026-11-20" });
  const transfer = (await admin.query(api.meslogistic.list, {}))[0];
  // Meslogistic gère uniquement la logistique : le paiement reste côté Bâtire.
  expect(transfer).not.toHaveProperty("payment");
  await expect(admin.mutation(api.meslogistic.schedule, { id: transfer._id, scheduledDate: "2026-02-30", expectedUpdatedAt: transfer.updatedAt })).rejects.toThrow();
  await admin.mutation(api.meslogistic.schedule, { id: transfer._id, scheduledDate: "2026-11-12", expectedUpdatedAt: transfer.updatedAt });
  const activity = await client.query(api.batire.myOrderActivity, {});
  const line = activity.orders.find(order => order._id === transfer.orderId);
  expect(line?.fulfillment).toMatchObject({ status: "scheduled", scheduledDate: "2026-11-12" });
  const updated = (await admin.query(api.meslogistic.list, {})).find(row => row._id === transfer._id)!;
  await expect(admin.mutation(api.meslogistic.advance, { id: transfer._id, step: "en_transit", expectedUpdatedAt: updated.updatedAt })).rejects.toThrow();
});

test("cash cannot be handed over before payment confirmation", async () => {
  const { t, client, admin, customer, items } = await fixture();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "professionnel" });
  await client.mutation(api.batire.requestOfflineCart, { customer, items: [{ ...items[0], pickupLocation: "comptoir_c" }], paymentMethod: "cash" });
  const order = (await t.run(ctx => ctx.db.query("btOrders").collect()))[0];
  await admin.mutation(api.batire.updatePickup, { orderId: order._id, step: "ready", availableFrom: "2026-11-21" });
  await expect(admin.mutation(api.batire.updatePickup, { orderId: order._id, step: "collect" })).rejects.toThrow();
  await admin.mutation(api.batire.confirmOfflinePayment, { orderId: order._id });
  await admin.mutation(api.batire.updatePickup, { orderId: order._id, step: "collect" });
  expect((await t.run(ctx => ctx.db.get(order._id)))?.collectedAt).toBeDefined();
});

test("a donation without a visible company preserves the saved company in the profile", async () => {
  const { t, client } = await fixture();
  await client.mutation(api.batireDons.saveMyDonorProfile, { customerType: "particulier", company: "Ancienne entreprise" });
  const photo = await t.run(ctx => ctx.storage.store(new Blob(["photo"], { type: "image/png" })));
  await client.mutation(api.batireDons.submitDonation, { title: "Bois", category: "Bois", photos: [photo], donor: { firstName: "Jean", lastName: "Test" } });
  expect((await client.query(api.batireDons.getMyDonorProfile, {}))?.company).toBe("Ancienne entreprise");
  expect((await t.run(ctx => ctx.db.query("btDonations").collect()))[0].donor.company).toBeUndefined();
});

test("a delivery request keeps one card and independent statuses for its materials", async () => {
  const { t, client, admin, customer, items } = await fixture();
  await client.mutation(api.batire.requestHomeDelivery, { customer, address: "Beauvais", items: items.map(({ materialId, quantity }) => ({ materialId, quantity })) });
  const request = (await admin.query(api.batire.listRequests, {}))[0];
  expect(request.items).toHaveLength(2);
  await expect(client.mutation(api.batire.updateRequestItemOutcome, { id: request._id, index: 0, outcome: "gagnee" })).rejects.toThrow();
  await admin.mutation(api.batire.updateRequestItemOutcome, { id: request._id, index: 0, outcome: "en_cours" });
  await admin.mutation(api.batire.updateRequestItemOutcome, { id: request._id, index: 1, outcome: "gagnee" });
  const updated = await t.run(ctx => ctx.db.get(request._id));
  expect(updated?.items.map(item => item.outcome)).toEqual(["en_cours", "gagnee"]);
  expect(updated?.outcome).toBe("nouveau");
  await expect(admin.mutation(api.batire.updateRequestItemOutcome, { id: request._id, index: 2, outcome: "perdue" })).rejects.toThrow();
});
