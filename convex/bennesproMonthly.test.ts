/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { aggregateBillingLines, billingMonth } from "./lib/bpMonthlyBilling";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("Paris month boundaries and year rollover", () => {
  expect(billingMonth(Date.parse("2026-11-30T22:59:59Z"))).toBe("2026-11");
  expect(billingMonth(Date.parse("2026-11-30T23:00:00Z"))).toBe("2026-12");
  expect(billingMonth(Date.parse("2026-06-30T22:00:00Z"))).toBe("2026-07");
  expect(billingMonth(Date.parse("2026-12-31T23:00:00Z"))).toBe("2027-01");
});

test("aggregation preserves recorded amounts when prices change", () => {
  const line = { material: "Bois", weightKg: 3, amountCents: 31, priceCentsPerKg: 10.33 };
  const result = aggregateBillingLines([line, { ...line, amountCents: 60, priceCentsPerKg: 20 }]);
  expect(result[0]).toMatchObject({ weightKg: 6, amountCents: 91 });
  expect(line.amountCents).toBe(31);
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const companyId = await ctx.db.insert("bpCompanies", { name: "Client", contactEmail: "contact@example.com", billingEmail: "billing@example.com", createdAt: 1 });
    const vehicleId = await ctx.db.insert("bpVehicles", { companyId, label: "Camion", plate: "AB-123-CD", createdAt: 1 });
    const depotIds = [];
    for (let i = 0; i < 2; i++) depotIds.push(await ctx.db.insert("bpDepots", {
      companyId, vehicleId, depotNumber: i + 1, depositorName: "Client", siteRef: "Site", attachments: [], createdAt: 1,
      items: [{ material: "Bois", unit: "kg", quantity: 10, siteRef: "Site" }],
      billing: { month: "2020-01", status: "pending", weightKg: 10, priceCentsPerKg: 10, amountCents: 100,
        items: [{ material: "Bois", weightKg: 10, priceCentsPerKg: 10, amountCents: 100 }] },
    }));
    return { companyId, depotIds };
  });
  return { t, ...ids };
}

test("one monthly claim per company, locking all deposits atomically", async () => {
  const { t, companyId, depotIds } = await fixture();
  const args = { companyId, month: "2020-01" };
  await t.run(async ctx => {
    const original = (await ctx.db.get(depotIds[0]))!;
    const { _id, _creationTime, ...copy } = original;
    await ctx.db.insert("bpDepots", { ...copy, billing: { ...copy.billing!, month: undefined, status: "invoiced", stripeInvoiceId: "in_historical" } });
    await ctx.db.insert("bpDepots", { ...copy, billing: { ...copy.billing!, month: "2099-01" } });
  });
  const first = await t.mutation(internal.bennesproMonthly.claim, args);
  expect(first?.batch.depotIds).toEqual(depotIds);
  expect(first?.batch.lines[0].amountCents).toBe(200);
  expect(first?.batch.details).toHaveLength(2);
  expect(first?.batch.details?.[0].description).toContain("Dépôt n° 0001 du 01/01/1970");
  expect(first?.batch.details?.[0].description).toContain("Bois : 10 kg");
  expect(first?.batch.details?.[0].description).toContain("Chantier : Site");
  expect(await t.mutation(internal.bennesproMonthly.claim, args)).toBeNull();
  expect(await t.mutation(internal.bennesproMonthly.claim, { companyId, month: "2099-01" })).toBeNull();
});

test("recording DIB and wood saves the amount without scheduling Stripe", async () => {
  const { t, companyId, depotIds } = await fixture();
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  const authenticated = t.withIdentity({ subject: "admin", email: "admin@example.com" });
  const { vehicleId, signature } = await t.run(async ctx => ({ vehicleId: (await ctx.db.get(depotIds[0]))!.vehicleId, signature: await ctx.storage.store(new Blob(["signature"])) }));
  const result = await authenticated.mutation(api.bennespro.createDepot, {
    companyId, vehicleId, depositorName: "Client", siteRef: "Site", attachments: [], signature,
    items: [{ material: "Bois", quantity: 1, unit: "tonne", siteRef: "Site" }, { material: "Tout venant/DIB non triés", quantity: 10, unit: "kg", siteRef: "Site" }],
  });
  const depot = await t.run(ctx => ctx.db.get(result.depotId));
  expect(depot?.billing).toMatchObject({ status: "pending", month: billingMonth(Date.now()), weightKg: 1010 });
  expect(depot?.billing?.stripeInvoiceId).toBeUndefined();
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
});

test("Stripe failure resumes same invoice and sends to billing email", async () => {
  const { t, companyId, depotIds } = await fixture();
  vi.stubEnv("BENNESPRO_STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("RESEND_API_KEY", "re_test_fake");
  vi.stubEnv("BENNESPRO_STRIPE_TVA_TAX_RATE_ID", "txr_test");
  let creates = 0, sends = 0, lineCreates = 0, failSend = true, failReceipts = true, customerEmail = "";
  let invoice: Record<string, unknown> | undefined;
  const lines: Array<{ metadata: { bpDetailKey: string } }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://api.resend.com/emails") {
      if (failReceipts) { failReceipts = false; return new Response("temporary mail failure", { status: 503 }); }
      return new Response(JSON.stringify({ id: "mail_test" }));
    }
    const path = url.replace("https://api.stripe.com/v1/", "");
    const body = new URLSearchParams(init?.body as string);
    let response: unknown = {};
    if (path.startsWith("customers?")) response = { data: [] };
    else if (path === "customers") { customerEmail = body.get("email")!; response = { id: "cus_test" }; }
    else if (path.startsWith("customers/")) response = { id: "cus_test" };
    else if (path.startsWith("invoices?")) response = { data: invoice ? [invoice] : [], has_more: false };
    else if (path === "invoices") {
      creates++;
      invoice = { id: "in_test", status: "draft", metadata: { bpMonthlyInvoiceId: body.get("metadata[bpMonthlyInvoiceId]") }, hosted_invoice_url: "https://example.com/invoice" };
      response = invoice;
    } else if (path.includes("/lines")) response = { data: lines };
    else if (path === "invoiceitems") { lineCreates++; lines.push({ metadata: { bpDetailKey: body.get("metadata[bpDetailKey]")! } }); }
    else if (path.endsWith("/finalize")) { invoice!.status = "open"; response = invoice; }
    else if (path.endsWith("/send")) {
      if (failSend) { failSend = false; return new Response(JSON.stringify({ error: { message: "temporary" } }), { status: 503 }); }
      sends++; response = invoice;
    } else if (path === "invoices/in_test") {
      if (body.get("metadata[bpMonthlySent]")) (invoice!.metadata as Record<string, string>).bpMonthlySent = "true";
      response = invoice;
    }
    else throw new Error(`Unexpected Stripe request ${path}`);
    return new Response(JSON.stringify(response));
  }));
  const args = { companyId, month: "2020-01" };
  await t.action(internal.bennesproMonthly.process, args);
  expect(creates).toBe(1);
  await t.action(internal.bennesproMonthly.process, args);
  expect((await t.run(ctx => ctx.db.get(depotIds[0])))?.billing?.status).toBe("pending");
  await t.action(internal.bennesproMonthly.process, args);
  expect({ creates, sends, lineCreates, customerEmail }).toEqual({ creates: 1, sends: 1, lineCreates: 2, customerEmail: "billing@example.com" });
  for (const id of depotIds) expect((await t.run(ctx => ctx.db.get(id)))?.billing).toMatchObject({ status: "invoiced", stripeInvoiceId: "in_test", amountCents: 100 });
  await t.mutation(internal.bennespro.saveInvoicePaymentStatus, { depotId: depotIds[0], paymentStatus: "paid" });
  for (const id of depotIds) expect((await t.run(ctx => ctx.db.get(id)))?.billing?.paymentStatus).toBe("paid");
  await expect(t.mutation(internal.bennespro.adminWipeDepot, { depotId: depotIds[0] })).rejects.toThrow("mensuelle");
});
