/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import { canGroupDeposit, depositInvoiceDetails, stripeDetailLines } from "./lib/bpMonthlyBilling";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function fixture() {
  vi.useFakeTimers();
  vi.stubEnv("ADMIN_EMAILS", "admin@example.com");
  vi.stubEnv("BENNESPRO_STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("RESEND_API_KEY", "re_test_fake");
  vi.stubEnv("BENNESPRO_STRIPE_TVA_TAX_RATE_ID", "txr_test");
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ subject: "admin", email: "admin@example.com" });
  const data = await t.run(async ctx => {
    const companyId = await ctx.db.insert("bpCompanies", { name: "Client", billingEmail: "billing@example.com", stripeCustomerId: "cus_test", createdAt: 1 });
    const vehicleId = await ctx.db.insert("bpVehicles", { companyId, label: "Camion", createdAt: 1 });
    const depotIds = [];
    for (let i = 0; i < 3; i++) depotIds.push(await ctx.db.insert("bpDepots", {
      companyId, vehicleId, depotNumber: i + 1, depositorName: "Client", siteRef: "Chantier A", attachments: [], createdAt: Date.parse(`2026-10-0${i + 1}T10:00:00Z`),
      items: [{ material: "Bois", unit: "tonne", quantity: 0.01, siteRef: "Chantier A" }],
      billing: { status: "invoiced", stripeInvoiceId: `in_old${i}`, paymentStatus: "open", weightKg: 10, priceCentsPerKg: 10, amountCents: 100,
        items: [{ material: "Bois", weightKg: 10, priceCentsPerKg: 10, amountCents: 100 }] },
    }));
    return { companyId, depotIds };
  });
  return { t, admin, ...data };
}

type FakeInvoice = { id: string; status: string; currency: string; subtotal: number; total: number; amount_paid: number; amount_remaining: number; metadata: Record<string, string>; hosted_invoice_url?: string };
function stripeMock(options: { failFinalize?: boolean; failVoidOnce?: string; paidDuringVoid?: string; lostVoidResponse?: string } = {}) {
  const invoices = new Map<string, FakeInvoice>();
  for (let i = 0; i < 3; i++) invoices.set(`in_old${i}`, { id: `in_old${i}`, status: "open", currency: "eur", subtotal: 100, total: 120, amount_paid: 0, amount_remaining: 120, metadata: {} });
  const lines: Array<{ id: string; metadata: { bpDetailKey: string }; amount: number; description: string }> = [];
  const events: string[] = [];
  let createCount = 0, sends = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://api.resend.com/emails") return new Response(JSON.stringify({ id: "mail_test" }));
    const path = url.replace("https://api.stripe.com/v1/", "");
    const body = new URLSearchParams(init?.body as string);
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (path.startsWith("customers/")) return json({ id: "cus_test" });
    if (path.startsWith("invoices?")) return json({ data: [...invoices.values()], has_more: false });
    if (path === "invoices") {
      createCount++;
      const invoice = { id: "in_new", status: "draft", currency: "eur", subtotal: 0, total: 0, amount_paid: 0, amount_remaining: 0, metadata: { bpMonthlyInvoiceId: body.get("metadata[bpMonthlyInvoiceId]")! }, hosted_invoice_url: "https://example.com/in_new" };
      invoices.set("in_new", invoice); events.push("create"); return json(invoice);
    }
    if (path === "invoiceitems") {
      lines.push({ id: `il_${lines.length}`, metadata: { bpDetailKey: body.get("metadata[bpDetailKey]")! }, amount: Number(body.get("amount")), description: body.get("description")! });
      invoices.get("in_new")!.subtotal += Number(body.get("amount"));
      return json({ id: `ii_${lines.length}` });
    }
    const [, id, operation] = path.split("/");
    const invoice = invoices.get(id);
    if (!invoice) throw new Error(`Unexpected Stripe request ${path}`);
    if (operation?.startsWith("lines")) return json({ data: lines, has_more: false });
    if (operation === "void") {
      if (options.paidDuringVoid === id) {
        invoice.status = "paid"; invoice.amount_paid = invoice.total; invoice.amount_remaining = 0;
        return json({ error: { message: "Already paid" } }, 400);
      }
      if (options.failVoidOnce === id) { options.failVoidOnce = undefined; return json({ error: { message: "temporary void failure" } }, 503); }
      if (invoice.status !== "open") throw new Error("Attempt to void a non-open invoice");
      invoice.status = "void"; events.push(`void:${id}`);
      if (options.lostVoidResponse === id) { options.lostVoidResponse = undefined; throw new Error("Connection lost after void"); }
      return json(invoice);
    }
    if (operation === "finalize") {
      if (options.failFinalize) { options.failFinalize = false; return json({ error: { message: "temporary finalize failure" } }, 503); }
      invoice.status = "open"; events.push("finalize"); return json(invoice);
    }
    if (operation === "send") { sends++; events.push("send"); return json(invoice); }
    if (init?.method === "DELETE") { invoices.delete(id); return json({ deleted: true }); }
    if (init?.method === "POST") {
      for (const [key, value] of body) if (key.startsWith("metadata[")) invoice.metadata[key.slice(9, -1)] = value;
    }
    return json(invoice);
  }));
  return { invoices, lines, events, stats: () => ({ createCount, sends }) };
}

test("selection enforces permissions, unpaid DIB/wood, company and whole invoice", async () => {
  const f = await fixture();
  await expect(f.t.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds })).rejects.toThrow();
  await f.t.run(async ctx => {
    const d = (await ctx.db.get(f.depotIds[0]))!;
    await ctx.db.patch(d._id, { billing: { ...d.billing!, paymentStatus: "paid" } });
  });
  await expect(f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds })).rejects.toThrow("non éligible");
  await f.t.run(async ctx => {
    const d = (await ctx.db.get(f.depotIds[0]))!;
    await ctx.db.patch(d._id, { billing: { ...d.billing!, paymentStatus: "open", stripeInvoiceId: "in_old1" } });
  });
  await expect(f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: [f.depotIds[1], f.depotIds[2]] })).rejects.toThrow("tous les dépôts");
});

test("grouped invoice details every deposit, voids originals once and retries without duplicate lines", async () => {
  const f = await fixture();
  const stripe = stripeMock({ failFinalize: true, lostVoidResponse: "in_old1" });
  const id = await f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds });
  await expect(f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds })).rejects.toThrow("non éligible");
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect((await f.t.run(ctx => ctx.db.get(id)))?.error).toContain("temporary finalize failure");
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.stats()).toEqual({ createCount: 1, sends: 1 });
  expect(stripe.lines).toHaveLength(3);
  expect(stripe.lines[0].description).toContain("Dépôt n° 0001 du 01/10/2026");
  expect(stripe.lines[0].description).toContain("Bois : 0.01 tonne");
  expect(stripe.lines[0].description).toContain("Chantier A");
  expect(stripe.events).toEqual(["create", "void:in_old0", "void:in_old1", "void:in_old2", "finalize", "send"]);
  for (const [i, depotId] of f.depotIds.entries()) {
    const d = await f.t.run(ctx => ctx.db.get(depotId));
    expect(d?.billing).toMatchObject({ stripeInvoiceId: "in_new", replacedStripeInvoiceIds: [`in_old${i}`], paymentStatus: "open", monthlyInvoiceId: id });
    expect(d?.billing?.groupingId).toBeUndefined();
  }
});

test("live paid, canceled and partially paid invoices are never replaced", async () => {
  const f = await fixture();
  const stripe = stripeMock();
  stripe.invoices.get("in_old0")!.status = "paid";
  stripe.invoices.get("in_old1")!.status = "void";
  stripe.invoices.get("in_old2")!.amount_paid = 10;
  stripe.invoices.get("in_old2")!.amount_remaining = 110;
  const id = await f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds });
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.events).toEqual(["create"]);
  expect(stripe.stats().sends).toBe(0);
  expect((await f.t.run(ctx => ctx.db.get(id)))?.status).toBe("canceled");
  for (const depotId of f.depotIds) expect((await f.t.run(ctx => ctx.db.get(depotId)))?.billing?.groupingId).toBeUndefined();
});

test("payment winning the void race is excluded; later refresh cannot change the paid deposit", async () => {
  const f = await fixture();
  const stripe = stripeMock({ paidDuringVoid: "in_old1" });
  const id = await f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds });
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.lines).toHaveLength(2);
  expect(stripe.events).not.toContain("void:in_old1");
  await f.t.mutation(internal.bennespro.saveInvoicePaymentStatus, { depotId: f.depotIds[0], expectedInvoiceId: "in_new", paymentStatus: "open" });
  expect((await f.t.run(ctx => ctx.db.get(f.depotIds[1])))?.billing).toMatchObject({ stripeInvoiceId: "in_old1", paymentStatus: "paid" });
  await f.t.mutation(internal.bennespro.saveInvoicePaymentStatus, { depotId: f.depotIds[0], expectedInvoiceId: "in_old0", paymentStatus: "void" });
  expect((await f.t.run(ctx => ctx.db.get(f.depotIds[0])))?.billing?.paymentStatus).toBe("open");
});

test("a partial void failure leaves replacement draft and resumes safely", async () => {
  const f = await fixture();
  const stripe = stripeMock({ failVoidOnce: "in_old1" });
  const id = await f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds });
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.invoices.get("in_new")?.status).toBe("draft");
  expect(stripe.stats().sends).toBe(0);
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.stats()).toEqual({ createCount: 1, sends: 1 });
  expect(stripe.events.filter(e => e === "void:in_old0")).toHaveLength(1);
});

test("amount mismatch blocks cancellation; limits do not silently truncate details", async () => {
  const f = await fixture();
  const stripe = stripeMock();
  stripe.invoices.get("in_old2")!.subtotal = 99;
  const id = await f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds });
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.events).toEqual([]);
  const d = (await f.t.run(ctx => ctx.db.get(f.depotIds[0])))!;
  const largeMonth = stripeDetailLines(depositInvoiceDetails(Array(1000).fill(d)));
  expect(largeMonth).toHaveLength(250);
  expect(largeMonth.reduce((sum, l) => sum + l.amountCents, 0)).toBe(100000);
  expect(largeMonth.flatMap(l => l.description.match(/Dépôt n°/g) ?? [])).toHaveLength(1000);
  expect(canGroupDeposit({ ...d, items: [{ material: "Métaux", unit: "kg", quantity: 1, siteRef: "" }] })).toBe(false);
});

test("manual grouping of accrued deposits excludes them from the monthly job", async () => {
  const f = await fixture();
  const stripe = stripeMock();
  await f.t.run(async ctx => {
    for (const id of f.depotIds) {
      const d = (await ctx.db.get(id))!;
      await ctx.db.patch(id, { billing: { ...d.billing!, month: "2020-01", status: "pending", paymentStatus: undefined, stripeInvoiceId: undefined } });
    }
  });
  const id = await f.admin.mutation(api.bennesproGrouping.create, { companyId: f.companyId, depotIds: f.depotIds });
  expect(await f.t.mutation(internal.bennesproMonthly.claim, { companyId: f.companyId, month: "2020-01" })).toBeNull();
  await f.t.action(internal.bennesproMonthly.processManual, { id });
  expect(stripe.events).toEqual(["create", "finalize", "send"]);
  expect(await f.t.mutation(internal.bennesproMonthly.claim, { companyId: f.companyId, month: "2020-01" })).toBeNull();
});
