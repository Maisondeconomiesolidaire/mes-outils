import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { formatUserName, requireCrmPermission, requireUser } from "./lib";

/**
 * Agents polyvalents (Recyclerie) — gestion des ouvriers polyvalents.
 *
 * Trois entités : les tâches (catalogue), les ouvriers (nom/prénom) et les
 * activités qui affectent un ouvrier à une tâche sur un créneau daté. Le tout
 * partage la même clé de permission `agents-polyvalents`.
 */
const PAGE_KEY = "agents-polyvalents";

/* ─── Tâches ──────────────────────────────────────────────────────────────── */

export const listTasks = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    return await ctx.db.query("polyvalentTasks").order("desc").collect();
  },
});

export const createTask = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const name = args.name.trim();
    if (!name) throw new Error("Le nom de la tâche est requis.");
    return await ctx.db.insert("polyvalentTasks", {
      name,
      createdBy: formatUserName(identity),
      createdAt: Date.now(),
    });
  },
});

export const updateTask = mutation({
  args: { id: v.id("polyvalentTasks"), name: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    const name = args.name.trim();
    if (!name) throw new Error("Le nom de la tâche est requis.");
    await ctx.db.patch(args.id, { name });
  },
});

export const deleteTask = mutation({
  args: { id: v.id("polyvalentTasks") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    // On retire aussi les activités liées : une tâche supprimée ne doit pas
    // laisser d'affectations orphelines dans le planning.
    const activities = await ctx.db
      .query("polyvalentActivities")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    await Promise.all(activities.map((activity) => ctx.db.delete(activity._id)));
    await ctx.db.delete(args.id);
  },
});

/* ─── Ouvriers ────────────────────────────────────────────────────────────── */

export const listWorkers = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    return await ctx.db.query("polyvalentWorkers").order("desc").collect();
  },
});

export const createWorker = mutation({
  args: { firstName: v.string(), lastName: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName && !lastName) throw new Error("Le nom de l'ouvrier est requis.");
    return await ctx.db.insert("polyvalentWorkers", {
      firstName,
      lastName,
      createdBy: formatUserName(identity),
      createdAt: Date.now(),
    });
  },
});

export const updateWorker = mutation({
  args: { id: v.id("polyvalentWorkers"), firstName: v.string(), lastName: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    const firstName = args.firstName.trim();
    const lastName = args.lastName.trim();
    if (!firstName && !lastName) throw new Error("Le nom de l'ouvrier est requis.");
    await ctx.db.patch(args.id, { firstName, lastName });
  },
});

export const deleteWorker = mutation({
  args: { id: v.id("polyvalentWorkers") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    const activities = await ctx.db
      .query("polyvalentActivities")
      .withIndex("by_worker", (q) => q.eq("workerId", args.id))
      .collect();
    await Promise.all(activities.map((activity) => ctx.db.delete(activity._id)));
    await ctx.db.delete(args.id);
  },
});

/* ─── Activités (affectations) ────────────────────────────────────────────── */

export const listActivities = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const activities = await ctx.db
      .query("polyvalentActivities")
      .withIndex("by_startAt")
      .order("desc")
      .collect();
    const [tasks, workers] = await Promise.all([
      ctx.db.query("polyvalentTasks").collect(),
      ctx.db.query("polyvalentWorkers").collect(),
    ]);
    const taskById = new Map(tasks.map((task) => [String(task._id), task]));
    const workerById = new Map(workers.map((worker) => [String(worker._id), worker]));
    return activities.map((activity) => {
      const task = taskById.get(String(activity.taskId)) ?? null;
      const worker = workerById.get(String(activity.workerId)) ?? null;
      return {
        ...activity,
        taskName: task?.name ?? "Tâche supprimée",
        workerName: worker
          ? `${worker.firstName} ${worker.lastName}`.trim()
          : "Ouvrier supprimé",
      };
    });
  },
});

export const createActivity = mutation({
  args: {
    taskId: v.id("polyvalentTasks"),
    workerId: v.id("polyvalentWorkers"),
    startAt: v.number(),
    endAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    if (!Number.isFinite(args.startAt) || !Number.isFinite(args.endAt)) {
      throw new Error("Dates de début et de fin requises.");
    }
    if (args.endAt < args.startAt) {
      throw new Error("La fin doit être après le début.");
    }
    const [task, worker] = await Promise.all([
      ctx.db.get(args.taskId),
      ctx.db.get(args.workerId),
    ]);
    if (!task) throw new Error("Tâche introuvable.");
    if (!worker) throw new Error("Ouvrier introuvable.");
    return await ctx.db.insert("polyvalentActivities", {
      taskId: args.taskId,
      workerId: args.workerId,
      startAt: args.startAt,
      endAt: args.endAt,
      createdBy: formatUserName(identity),
      createdAt: Date.now(),
    });
  },
});

export const updateActivity = mutation({
  args: {
    id: v.id("polyvalentActivities"),
    taskId: v.id("polyvalentTasks"),
    workerId: v.id("polyvalentWorkers"),
    startAt: v.number(),
    endAt: v.number(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    if (!Number.isFinite(args.startAt) || !Number.isFinite(args.endAt)) {
      throw new Error("Dates de début et de fin requises.");
    }
    if (args.endAt < args.startAt) {
      throw new Error("La fin doit être après le début.");
    }
    const [task, worker] = await Promise.all([
      ctx.db.get(args.taskId),
      ctx.db.get(args.workerId),
    ]);
    if (!task) throw new Error("Tâche introuvable.");
    if (!worker) throw new Error("Ouvrier introuvable.");
    await ctx.db.patch(args.id, {
      taskId: args.taskId,
      workerId: args.workerId,
      startAt: args.startAt,
      endAt: args.endAt,
    });
  },
});

export const deleteActivity = mutation({
  args: { id: v.id("polyvalentActivities") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    await ctx.db.delete(args.id);
  },
});
