/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import schema from "./schema";
import { internal } from "./_generated/api";
import { billingTotals } from "./lib/bpMonthlyBilling";
import { buildReceiptPdf } from "./lib/bpReceiptPdf";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("selection TTC sums each deposit's tax with cent rounding", () => {
  const bill = (amountCents: number, vatRate = 20) => ({ billing: { amountCents, vatRate } } as Pick<Doc<"bpDepots">, "billing">);
  expect(billingTotals([bill(101), bill(102), bill(1000, 10)])).toEqual({ ht: 1203, ttc: 1343 });
});

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const companyId = await ctx.db.insert("bpCompanies", { name: "Client", billingEmail: "billing@example.com", createdAt: 1 });
    const vehicleId = await ctx.db.insert("bpVehicles", { companyId, label: "Camion", plate: "AB-123-CD", createdAt: 1 });
    const depotIds = [];
    for (let i = 1; i <= 12; i++) depotIds.push(await ctx.db.insert("bpDepots", {
      companyId, vehicleId, depotNumber: i, depositorName: "Client", siteRef: "Chantier", attachments: [], createdAt: 1,
      items: [{ material: "Bois", unit: "kg", quantity: i, siteRef: "Chantier" }],
    }));
    const id = await ctx.db.insert("bpMonthlyInvoices", {
      companyId, month: "2026-10", depotIds, lines: [], status: "pending", leaseUntil: 0, stripeInvoiceId: "in_test",
      sources: [{ invoiceId: "in_paid", depotIds: [depotIds[11]], amountCents: 100, outcome: "excluded" }],
    });
    return { id, companyId, depotIds, vehicleId };
  });
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("BENNESPRO_STRIPE_SECRET_KEY", "sk_test");
  return { t, ...ids };
}

test("all included receipts are PDFs, excluded deposits stay out, failed emails resume without resending successful parts", async () => {
  const f = await fixture();
  const emails: Array<{ attachments: Array<{ filename: string; content: string }>; to: string[] }> = [];
  let attempts = 0;
  const keys: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("api.stripe.com")) return new Response(JSON.stringify({ id: "in_test", number: "INV-1", status: "open", total: 1200, hosted_invoice_url: "https://example.com/invoice" }));
    if (url === "https://api.resend.com/emails") {
      attempts++;
      keys.push((init?.headers as Record<string, string>)["Idempotency-Key"]);
      if (attempts === 2) return new Response("temporary", { status: 503 });
      emails.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ id: "email" }));
    }
    throw new Error(`Unexpected request ${url}`);
  }));
  await expect(f.t.action(internal.bennesproReceiptEmails.send, { id: f.id })).rejects.toThrow("Échec de l'envoi");
  expect((await f.t.run(ctx => ctx.db.get(f.id)))?.receiptPartsSent).toEqual([0]);
  expect((await f.t.run(ctx => ctx.db.get(f.id)))?.status).toBe("pending");
  await f.t.action(internal.bennesproReceiptEmails.send, { id: f.id });
  await f.t.action(internal.bennesproReceiptEmails.send, { id: f.id });
  expect(attempts).toBe(3);
  expect(keys[1]).toBe(keys[2]);
  const attachments = emails.flatMap(e => e.attachments);
  expect(attachments.map(a => a.filename)).toEqual(Array.from({ length: 11 }, (_, i) => `bon-depot-${String(i + 1).padStart(4, "0")}.pdf`));
  for (const a of attachments) {
    const pdf = await PDFDocument.load(Uint8Array.from(atob(a.content), c => c.charCodeAt(0)));
    expect(pdf.getPageCount()).toBe(1);
  }
  expect(emails.every(e => e.to[0] === "billing@example.com")).toBe(true);
});

test("receipt PDF retains signature and paginates long deposits deterministically", async () => {
  const f = await fixture();
  const data = await f.t.run(async ctx => ({ depot: (await ctx.db.get(f.depotIds[0]))!, company: (await ctx.db.get(f.companyId))!, vehicle: (await ctx.db.get(f.vehicleId))! }));
  const signature = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="), c => c.charCodeAt(0));
  data.depot.items = Array(100).fill(data.depot.items[0]);
  const first = await buildReceiptPdf(data.depot, data.company, data.vehicle, signature);
  expect(first).toEqual(await buildReceiptPdf(data.depot, data.company, data.vehicle, signature));
  const pdf = await PDFDocument.load(first);
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  expect(pdf.getTitle()).toBe("Bon de dépôt 1");
});

test("missing email configuration fails rather than silently marking receipts sent", async () => {
  const f = await fixture();
  vi.stubEnv("RESEND_API_KEY", "");
  await expect(f.t.action(internal.bennesproReceiptEmails.send, { id: f.id })).rejects.toThrow("RESEND_API_KEY");
  expect((await f.t.run(ctx => ctx.db.get(f.id)))?.receiptPartsSent).toBeUndefined();
});
