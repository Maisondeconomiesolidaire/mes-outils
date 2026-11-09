/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, afterEach, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { ensureOrderTransport } from "./meslogistic";
import { transportRoute } from "./meslogisticRules";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
async function fixture(depot = "Comptoir C") {
  vi.useFakeTimers(); vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const t = convexTest(schema, modules);
  const materialId = await t.run(ctx => ctx.db.insert("btMaterials", { title: "Lot de portes", description: "Bois", category: "Menuiserie", condition: "bon_etat", unit: "unite", quantity: 10, price: 20, depot, photos: [], status: "disponible", createdAt: 1, updatedAt: 1 }));
  return { t, materialId, admin: t.withIdentity({ subject: "admin", email: "admin@example.com" }) };
}
const customer = { firstName: "Jean", lastName: "Test", email: "test@example.com" };
test("same depot and old aliases require no transport", () => {
 expect(transportRoute("Recyclerie du Pays de Bray", "usine_agile")).toBeNull();
 expect(transportRoute("Comptoir C", "comptoir_c")).toBeNull();
 expect(transportRoute(undefined, "esspace_150")?.origin).toBe("Lieu de départ à préciser");
});
test("reservation creates one transport; payment and replay never duplicate it", async () => {
 const {t,materialId}=await fixture();
 const client=t.withIdentity({subject:"client",email:customer.email});
 await client.mutation(api.batireDons.saveMyDonorProfile,{customerType:"professionnel"});
 await client.mutation(api.batire.reserveMaterial,{materialId,quantity:2,customer,pickupLocation:"esspace_150"});
 const orders=await t.run(ctx=>ctx.db.query("btOrders").collect());
 expect(orders[0].logisticsSourceDepot).toBe("Comptoir C");
 await t.run(async ctx=>{await ctx.db.patch(orders[0]._id,{status:"payee"});await ensureOrderTransport(ctx,orders[0]._id);await ensureOrderTransport(ctx,orders[0]._id);});
 const rows=await t.run(ctx=>ctx.db.query("mlRequests").collect());expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({quantity:2,origin:"Comptoir C",destination:"Esspace 150 / Recyclerie de Gournay"});
});
test("unpaid checkout creates no transport; confirmed payment uses frozen departure", async () => {
 const {t,materialId}=await fixture();
 const {orderId}=await t.mutation(internal.batire.createOrder,{materialId,quantity:2,customer,channel:"boutique",pickupLocation:"esspace_150"});
 expect(await t.run(ctx=>ctx.db.query("mlRequests").collect())).toHaveLength(0);
 await t.run(ctx=>ctx.db.patch(materialId,{depot:"Esspace 150"}));
 await t.mutation(internal.batire.markOrderPaid,{orderId});await t.mutation(internal.batire.markOrderPaid,{orderId});
 const rows=await t.run(ctx=>ctx.db.query("mlRequests").collect());expect(rows).toHaveLength(1);expect(rows[0].origin).toBe("Comptoir C");
 expect((await t.run(ctx=>ctx.db.get(materialId)))?.quantity).toBe(8);
});
test("same site reservation creates no request",async()=>{const {t,materialId}=await fixture();const client=t.withIdentity({subject:"client",email:customer.email});await client.mutation(api.batireDons.saveMyDonorProfile,{customerType:"professionnel"});await client.mutation(api.batire.reserveMaterial,{materialId,quantity:1,customer,pickupLocation:"comptoir_c"});expect(await t.run(ctx=>ctx.db.query("mlRequests").collect())).toHaveLength(0);});
test("permissions, sequential steps, stale writes and history are enforced",async()=>{
 const {t,admin}=await fixture();
 const values={title:"Porte",quantity:1,unit:"unité",customerName:"Interne",origin:"Comptoir C",destination:"Esspace 150",scheduledDate:"2026-11-12"};
 await expect(t.mutation(api.meslogistic.create,values)).rejects.toThrow();
 const outsider=t.withIdentity({subject:"visitor",email:"visitor@example.com"});await expect(outsider.query(api.meslogistic.list,{})).rejects.toThrow();
 const id=await admin.mutation(api.meslogistic.create,values);
 const row=async()=> (await t.run(ctx=>ctx.db.get(id)))!;
 await expect(admin.mutation(api.meslogistic.advance,{id,step:"receptionnee",expectedUpdatedAt:(await row()).updatedAt})).rejects.toThrow();
 const version=(await row()).updatedAt;
 await admin.mutation(api.meslogistic.advance,{id,step:"prepared",expectedUpdatedAt:version});
 await expect(admin.mutation(api.meslogistic.advance,{id,step:"en_transit",expectedUpdatedAt:version})).rejects.toThrow();
 await admin.mutation(api.meslogistic.advance,{id,step:"en_transit",expectedUpdatedAt:(await row()).updatedAt});
 await admin.mutation(api.meslogistic.advance,{id,step:"receptionnee",expectedUpdatedAt:(await row()).updatedAt});
 expect((await row()).status).toBe("receptionnee");expect(await admin.query(api.meslogistic.history,{id})).toHaveLength(4);
});
test("shuttles are created, previewed with their transits, and assignments follow the shuttle date",async()=>{
 const {t,admin}=await fixture();
 const values={title:"Porte",quantity:1,unit:"unité",customerName:"Interne",origin:"Comptoir C",destination:"Esspace 150"};
 const outsider=t.withIdentity({subject:"visitor",email:"visitor@example.com"});
 await expect(outsider.mutation(api.meslogistic.createShuttle,{name:"Navette",scheduledDate:"2026-11-12"})).rejects.toThrow();
 await expect(admin.mutation(api.meslogistic.createShuttle,{name:" ",scheduledDate:"2026-11-12"})).rejects.toThrow();
 await expect(admin.mutation(api.meslogistic.createShuttle,{name:"Navette",scheduledDate:"2026-02-31"})).rejects.toThrow();
 const first=await admin.mutation(api.meslogistic.createShuttle,{name:"Tournée mardi",scheduledDate:"2026-11-12"});
 const second=await admin.mutation(api.meslogistic.createShuttle,{name:"Tournée jeudi",scheduledDate:"2026-11-14"});
 const id=await admin.mutation(api.meslogistic.create,values);
 const row=async()=> (await t.run(ctx=>ctx.db.get(id)))!;
 await admin.mutation(api.meslogistic.assignShuttle,{id,shuttleId:first,expectedUpdatedAt:(await row()).updatedAt});
 expect(await row()).toMatchObject({shuttleId:first,scheduledDate:"2026-11-12",prepared:true});
 const stale=(await row()).updatedAt;
 await admin.mutation(api.meslogistic.assignShuttle,{id,shuttleId:second,expectedUpdatedAt:stale});
 await expect(admin.mutation(api.meslogistic.assignShuttle,{id,shuttleId:first,expectedUpdatedAt:stale})).rejects.toThrow();
 const overview=await admin.query(api.meslogistic.shuttlesOverview,{});
 expect(overview.find(s=>s._id===first)?.transits).toHaveLength(0);
 expect(overview.find(s=>s._id===second)?.transits.map(r=>r._id)).toEqual([id]);
 expect((await row()).scheduledDate).toBe("2026-11-14");
 await admin.mutation(api.meslogistic.assignShuttle,{id,shuttleId:null,expectedUpdatedAt:(await row()).updatedAt});
 expect((await row()).shuttleId).toBeUndefined();
 const list=await admin.query(api.meslogistic.list,{});expect(list[0]).not.toHaveProperty("payment");
});
