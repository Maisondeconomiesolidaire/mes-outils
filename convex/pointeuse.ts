import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireStaff } from "./lib";

/**
 * App « Pointeuse LSDB » — suivi des salariés et des chantiers.
 *
 * Toutes les fonctions sont réservées au personnel (`requireStaff`). Les tables
 * sont préfixées `pt` (cf. `schema.ts`). Les montants sont en euros, les dates
 * en millisecondes.
 *
 * Règles de calcul (figées en snapshot au moment du pointage) :
 *  - coût d'un salarié   = heures × taux horaire environné ;
 *  - coût des déplacements = nb d'aller-retours × distance aller (km) × 2 × 1 €/km.
 */

const TRAVEL_RATE_PER_KM = 1; // 1 € / km

/* ─── Salariés ────────────────────────────────────────────────────────────── */

const employeeStatus = v.union(
  v.literal("MAD"),
  v.literal("Compagnon permanent"),
  v.literal("Compagnon insertion"),
  v.literal("Renfort ponctuel"),
  v.literal("Encadrant"),
);

export const listEmployees = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const employees = await ctx.db.query("ptEmployees").order("desc").collect();
    return employees.sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(
        `${b.lastName} ${b.firstName}`,
        "fr",
      ),
    );
  },
});

export const createEmployee = mutation({
  args: {
    firstName: v.string(),
    lastName: v.string(),
    status: employeeStatus,
    hourlyRate: v.number(),
    active: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await ctx.db.insert("ptEmployees", {
      firstName: args.firstName.trim(),
      lastName: args.lastName.trim(),
      status: args.status,
      hourlyRate: args.hourlyRate,
      active: args.active ?? true,
      createdAt: Date.now(),
    });
  },
});

export const updateEmployee = mutation({
  args: {
    employeeId: v.id("ptEmployees"),
    firstName: v.string(),
    lastName: v.string(),
    status: employeeStatus,
    hourlyRate: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, { employeeId, ...patch }) => {
    await requireStaff(ctx);
    await ctx.db.patch(employeeId, {
      firstName: patch.firstName.trim(),
      lastName: patch.lastName.trim(),
      status: patch.status,
      hourlyRate: patch.hourlyRate,
      active: patch.active,
    });
  },
});

export const deleteEmployee = mutation({
  args: { employeeId: v.id("ptEmployees") },
  handler: async (ctx, { employeeId }) => {
    await requireStaff(ctx);
    await ctx.db.delete(employeeId);
  },
});

/* ─── Clients ─────────────────────────────────────────────────────────────── */

const clientFields = {
  name: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
  notes: v.optional(v.string()),
};

export const listClients = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const clients = await ctx.db.query("ptClients").order("desc").collect();
    return clients.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

export const createClient = mutation({
  args: clientFields,
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await ctx.db.insert("ptClients", {
      ...args,
      name: args.name.trim(),
      createdAt: Date.now(),
    });
  },
});

export const updateClient = mutation({
  args: { clientId: v.id("ptClients"), ...clientFields },
  handler: async (ctx, { clientId, ...patch }) => {
    await requireStaff(ctx);
    await ctx.db.patch(clientId, { ...patch, name: patch.name.trim() });
  },
});

export const deleteClient = mutation({
  args: { clientId: v.id("ptClients") },
  handler: async (ctx, { clientId }) => {
    await requireStaff(ctx);
    const projects = await ctx.db
      .query("ptProjects")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .collect();
    if (projects.length > 0) {
      throw new Error(
        "Impossible de supprimer : des projets sont rattachés à ce client.",
      );
    }
    await ctx.db.delete(clientId);
  },
});

/* ─── Projets ─────────────────────────────────────────────────────────────── */

const projectStatus = v.union(
  v.literal("en_cours"),
  v.literal("termine"),
  v.literal("en_pause"),
);

const projectFields = {
  name: v.string(),
  clientId: v.id("ptClients"),
  address: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  city: v.optional(v.string()),
  lat: v.optional(v.number()),
  lon: v.optional(v.number()),
  distanceKm: v.number(),
  status: projectStatus,
  notes: v.optional(v.string()),
};

export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const projects = await ctx.db.query("ptProjects").order("desc").collect();
    const clients = await ctx.db.query("ptClients").collect();
    const nameById = new Map(clients.map((c) => [c._id, c.name]));
    return projects
      .map((p) => ({ ...p, clientName: nameById.get(p.clientId) ?? "—" }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

export const createProject = mutation({
  args: projectFields,
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const client = await ctx.db.get(args.clientId);
    if (!client) throw new Error("Client introuvable.");
    return await ctx.db.insert("ptProjects", {
      ...args,
      name: args.name.trim(),
      createdAt: Date.now(),
    });
  },
});

export const updateProject = mutation({
  args: { projectId: v.id("ptProjects"), ...projectFields },
  handler: async (ctx, { projectId, ...patch }) => {
    await requireStaff(ctx);
    await ctx.db.patch(projectId, { ...patch, name: patch.name.trim() });
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("ptProjects") },
  handler: async (ctx, { projectId }) => {
    await requireStaff(ctx);
    const entries = await ctx.db
      .query("ptTimeEntries")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    if (entries.length > 0) {
      throw new Error(
        "Impossible de supprimer : des pointages sont rattachés à ce projet.",
      );
    }
    await ctx.db.delete(projectId);
  },
});

/**
 * Fiche projet agrégée : coûts de main-d'œuvre (pointages), dépenses, factures
 * (facturé / payé / en attente) et documents rattachés.
 */
export const projectSummary = query({
  args: { projectId: v.id("ptProjects") },
  handler: async (ctx, { projectId }) => {
    await requireStaff(ctx);
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const client = await ctx.db.get(project.clientId);

    const [entries, expenses, invoices, documents] = await Promise.all([
      ctx.db
        .query("ptTimeEntries")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc")
        .collect(),
      ctx.db
        .query("ptExpenses")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc")
        .collect(),
      ctx.db
        .query("ptInvoices")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc")
        .collect(),
      ctx.db
        .query("ptDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .order("desc")
        .collect(),
    ]);

    const laborCost = entries.reduce((s, e) => s + e.laborCost, 0);
    const travelCost = entries.reduce((s, e) => s + e.travelCost, 0);
    const totalPointed = entries.reduce((s, e) => s + e.totalCost, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
    const paid = invoices
      .filter((i) => i.status === "payee")
      .reduce((s, i) => s + i.amount, 0);
    const pending = invoiced - paid;

    const docsWithUrl = await Promise.all(
      documents.map(async (d) => ({
        ...d,
        url: await ctx.storage.getUrl(d.storageId),
      })),
    );

    return {
      project: { ...project, clientName: client?.name ?? "—" },
      entries,
      expenses,
      invoices,
      documents: docsWithUrl,
      totals: {
        laborCost,
        travelCost,
        totalPointed,
        totalExpenses,
        invoiced,
        paid,
        pending,
      },
    };
  },
});

/* ─── Fournisseurs ────────────────────────────────────────────────────────── */

const supplierFields = {
  name: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  notes: v.optional(v.string()),
};

export const listSuppliers = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const suppliers = await ctx.db.query("ptSuppliers").order("desc").collect();
    return suppliers.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});

export const createSupplier = mutation({
  args: supplierFields,
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    return await ctx.db.insert("ptSuppliers", {
      ...args,
      name: args.name.trim(),
      createdAt: Date.now(),
    });
  },
});

export const updateSupplier = mutation({
  args: { supplierId: v.id("ptSuppliers"), ...supplierFields },
  handler: async (ctx, { supplierId, ...patch }) => {
    await requireStaff(ctx);
    await ctx.db.patch(supplierId, { ...patch, name: patch.name.trim() });
  },
});

export const deleteSupplier = mutation({
  args: { supplierId: v.id("ptSuppliers") },
  handler: async (ctx, { supplierId }) => {
    await requireStaff(ctx);
    await ctx.db.delete(supplierId);
  },
});

/* ─── Pointages ───────────────────────────────────────────────────────────── */

export const listTimeEntries = query({
  args: { projectId: v.optional(v.id("ptProjects")) },
  handler: async (ctx, { projectId }) => {
    await requireStaff(ctx);
    const entries = projectId
      ? await ctx.db
          .query("ptTimeEntries")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .order("desc")
          .collect()
      : await ctx.db.query("ptTimeEntries").order("desc").collect();

    const [projects, clients, employees] = await Promise.all([
      ctx.db.query("ptProjects").collect(),
      ctx.db.query("ptClients").collect(),
      ctx.db.query("ptEmployees").collect(),
    ]);
    const projectName = new Map(projects.map((p) => [p._id, p.name]));
    const clientName = new Map(clients.map((c) => [c._id, c.name]));
    const empName = new Map(
      employees.map((e) => [e._id, `${e.firstName} ${e.lastName}`]),
    );

    return entries.map((e) => ({
      ...e,
      projectName: projectName.get(e.projectId) ?? "—",
      clientName: clientName.get(e.clientId) ?? "—",
      lines: e.lines.map((l) => ({
        ...l,
        employeeName: empName.get(l.employeeId) ?? "—",
      })),
    }));
  },
});

export const createTimeEntry = mutation({
  args: {
    projectId: v.id("ptProjects"),
    date: v.number(),
    lines: v.array(
      v.object({ employeeId: v.id("ptEmployees"), hours: v.number() }),
    ),
    roundTrips: v.optional(v.number()),
    notes: v.optional(v.string()),
    documentIds: v.optional(v.array(v.id("ptDocuments"))),
  },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Projet introuvable.");

    // Coûts main-d'œuvre : snapshot du taux horaire courant de chaque salarié.
    const lines = [];
    for (const line of args.lines) {
      if (line.hours <= 0) continue;
      const employee = await ctx.db.get(line.employeeId);
      if (!employee) throw new Error("Salarié introuvable.");
      const cost = round2(line.hours * employee.hourlyRate);
      lines.push({
        employeeId: line.employeeId,
        hours: line.hours,
        hourlyRate: employee.hourlyRate,
        cost,
      });
    }
    if (lines.length === 0) {
      throw new Error("Renseignez au moins un salarié avec des heures.");
    }
    const laborCost = round2(lines.reduce((s, l) => s + l.cost, 0));

    // Coût déplacements : AR × distance aller × 2 × 1 €/km.
    const roundTrips = args.roundTrips ?? 0;
    const travelCost =
      roundTrips > 0
        ? round2(roundTrips * project.distanceKm * 2 * TRAVEL_RATE_PER_KM)
        : 0;
    const travel =
      roundTrips > 0
        ? { roundTrips, distanceKm: project.distanceKm, cost: travelCost }
        : undefined;

    const entryId = await ctx.db.insert("ptTimeEntries", {
      projectId: args.projectId,
      clientId: project.clientId,
      date: args.date,
      lines,
      travel,
      laborCost,
      travelCost,
      totalCost: round2(laborCost + travelCost),
      notes: args.notes,
      documentIds: args.documentIds ?? [],
      createdAt: Date.now(),
      createdBy: identity.email ?? undefined,
    });

    // Rattache les documents au pointage (ils portent déjà le projet).
    for (const docId of args.documentIds ?? []) {
      await ctx.db.patch(docId, { timeEntryId: entryId });
    }
    return entryId;
  },
});

export const deleteTimeEntry = mutation({
  args: { entryId: v.id("ptTimeEntries") },
  handler: async (ctx, { entryId }) => {
    await requireStaff(ctx);
    await ctx.db.delete(entryId);
  },
});

/* ─── Dépenses ────────────────────────────────────────────────────────────── */

export const listExpenses = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const expenses = await ctx.db.query("ptExpenses").order("desc").collect();
    const [projects, suppliers] = await Promise.all([
      ctx.db.query("ptProjects").collect(),
      ctx.db.query("ptSuppliers").collect(),
    ]);
    const projectName = new Map(projects.map((p) => [p._id, p.name]));
    const supplierName = new Map(suppliers.map((s) => [s._id, s.name]));
    return expenses.map((e) => ({
      ...e,
      projectName: e.projectId ? projectName.get(e.projectId) ?? "—" : null,
      supplierName: e.supplierId ? supplierName.get(e.supplierId) ?? "—" : null,
    }));
  },
});

export const createExpense = mutation({
  args: {
    label: v.string(),
    amount: v.number(),
    date: v.number(),
    projectId: v.optional(v.id("ptProjects")),
    supplierId: v.optional(v.id("ptSuppliers")),
    category: v.optional(v.string()),
    documentIds: v.optional(v.array(v.id("ptDocuments"))),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const expenseId = await ctx.db.insert("ptExpenses", {
      label: args.label.trim(),
      amount: args.amount,
      date: args.date,
      projectId: args.projectId,
      supplierId: args.supplierId,
      category: args.category,
      documentIds: args.documentIds ?? [],
      createdAt: Date.now(),
    });
    for (const docId of args.documentIds ?? []) {
      await ctx.db.patch(docId, { expenseId });
    }
    return expenseId;
  },
});

export const deleteExpense = mutation({
  args: { expenseId: v.id("ptExpenses") },
  handler: async (ctx, { expenseId }) => {
    await requireStaff(ctx);
    await ctx.db.delete(expenseId);
  },
});

/* ─── Factures ────────────────────────────────────────────────────────────── */

const invoiceStatus = v.union(
  v.literal("brouillon"),
  v.literal("envoyee"),
  v.literal("payee"),
  v.literal("en_retard"),
);

export const listInvoices = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const invoices = await ctx.db.query("ptInvoices").order("desc").collect();
    const [projects, clients] = await Promise.all([
      ctx.db.query("ptProjects").collect(),
      ctx.db.query("ptClients").collect(),
    ]);
    const projectName = new Map(projects.map((p) => [p._id, p.name]));
    const clientName = new Map(clients.map((c) => [c._id, c.name]));
    return invoices.map((i) => ({
      ...i,
      projectName: projectName.get(i.projectId) ?? "—",
      clientName: clientName.get(i.clientId) ?? "—",
    }));
  },
});

export const createInvoice = mutation({
  args: {
    projectId: v.id("ptProjects"),
    number: v.string(),
    amount: v.number(),
    status: invoiceStatus,
    issuedAt: v.number(),
    dueAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    documentIds: v.optional(v.array(v.id("ptDocuments"))),
  },
  handler: async (ctx, args) => {
    await requireStaff(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Projet introuvable.");
    const invoiceId = await ctx.db.insert("ptInvoices", {
      projectId: args.projectId,
      clientId: project.clientId,
      number: args.number.trim(),
      amount: args.amount,
      status: args.status,
      issuedAt: args.issuedAt,
      dueAt: args.dueAt,
      paidAt: args.paidAt,
      notes: args.notes,
      documentIds: args.documentIds ?? [],
      createdAt: Date.now(),
    });
    for (const docId of args.documentIds ?? []) {
      await ctx.db.patch(docId, { invoiceId });
    }
    return invoiceId;
  },
});

export const updateInvoiceStatus = mutation({
  args: {
    invoiceId: v.id("ptInvoices"),
    status: invoiceStatus,
    paidAt: v.optional(v.number()),
  },
  handler: async (ctx, { invoiceId, status, paidAt }) => {
    await requireStaff(ctx);
    await ctx.db.patch(invoiceId, {
      status,
      paidAt: status === "payee" ? paidAt ?? Date.now() : undefined,
    });
  },
});

export const deleteInvoice = mutation({
  args: { invoiceId: v.id("ptInvoices") },
  handler: async (ctx, { invoiceId }) => {
    await requireStaff(ctx);
    await ctx.db.delete(invoiceId);
  },
});

/* ─── Documents ───────────────────────────────────────────────────────────── */

/**
 * Enregistre un document déjà uploadé (via `files.generateUploadUrl`) et le
 * rattache à un projet. S'il provient d'un pointage, `timeEntryId` sera posé au
 * moment de la création du pointage.
 */
export const registerDocument = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    mimeType: v.optional(v.string()),
    projectId: v.id("ptProjects"),
  },
  handler: async (ctx, args) => {
    const identity = await requireStaff(ctx);
    return await ctx.db.insert("ptDocuments", {
      storageId: args.storageId,
      name: args.name,
      mimeType: args.mimeType,
      projectId: args.projectId,
      uploadedAt: Date.now(),
      uploadedBy: identity.email ?? undefined,
    });
  },
});

export const deleteDocument = mutation({
  args: { documentId: v.id("ptDocuments") },
  handler: async (ctx, { documentId }) => {
    await requireStaff(ctx);
    const doc = await ctx.db.get(documentId);
    if (doc) await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(documentId);
  },
});

/* ─── Tableau de bord ─────────────────────────────────────────────────────── */

export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await requireStaff(ctx);
    const [projects, entries, invoices, employees] = await Promise.all([
      ctx.db.query("ptProjects").collect(),
      ctx.db.query("ptTimeEntries").order("desc").collect(),
      ctx.db.query("ptInvoices").collect(),
      ctx.db.query("ptEmployees").collect(),
    ]);
    const totalPointed = entries.reduce((s, e) => s + e.totalCost, 0);
    const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
    const paid = invoices
      .filter((i) => i.status === "payee")
      .reduce((s, i) => s + i.amount, 0);
    return {
      projectsInProgress: projects.filter((p) => p.status === "en_cours").length,
      projectsTotal: projects.length,
      activeEmployees: employees.filter((e) => e.active).length,
      entriesCount: entries.length,
      totalPointed: round2(totalPointed),
      invoiced: round2(invoiced),
      pending: round2(invoiced - paid),
      recentEntries: entries.slice(0, 5),
    };
  },
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
