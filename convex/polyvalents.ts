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
    const recurrences = await ctx.db
      .query("polyvalentTaskRecurrences")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    await Promise.all(activities.map((activity) => ctx.db.delete(activity._id)));
    await Promise.all(recurrences.map((recurrence) => ctx.db.delete(recurrence._id)));
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
    const schedule = await ctx.db
      .query("polyvalentWorkerSchedules")
      .withIndex("by_worker", (q) => q.eq("workerId", args.id))
      .unique();
    const recurrences = await ctx.db
      .query("polyvalentTaskRecurrences")
      .withIndex("by_worker", (q) => q.eq("workerId", args.id))
      .collect();
    await Promise.all(activities.map((activity) => ctx.db.delete(activity._id)));
    await Promise.all(recurrences.map((recurrence) => ctx.db.delete(recurrence._id)));
    if (schedule) await ctx.db.delete(schedule._id);
    await ctx.db.delete(args.id);
  },
});

const availabilityValidator = v.array(v.object({
  weekday: v.number(),
  start: v.string(),
  end: v.string(),
}));

export const listWorkerSchedules = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    return await ctx.db.query("polyvalentWorkerSchedules").take(500);
  },
});

export const setWorkerSchedule = mutation({
  args: { workerId: v.id("polyvalentWorkers"), availability: availabilityValidator },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    if (args.availability.length > 7) throw new Error("Un planning contient au maximum 7 jours.");
    const days = new Set<number>();
    for (const slot of args.availability) {
      if (!Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7 || days.has(slot.weekday)) throw new Error("Les jours de disponibilité sont invalides.");
      if (!/^\d{2}:\d{2}$/.test(slot.start) || !/^\d{2}:\d{2}$/.test(slot.end) || slot.end <= slot.start) throw new Error("Les horaires de disponibilité sont invalides.");
      days.add(slot.weekday);
    }
    if (!await ctx.db.get(args.workerId)) throw new Error("Ouvrier introuvable.");
    const schedule = await ctx.db.query("polyvalentWorkerSchedules").withIndex("by_worker", (q) => q.eq("workerId", args.workerId)).unique();
    if (schedule) await ctx.db.patch(schedule._id, { availability: args.availability });
    else await ctx.db.insert("polyvalentWorkerSchedules", args);
  },
});

const recurrenceSlotsValidator = v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string() }));

export const listRecurrences = query({
  args: {},
  handler: async (ctx) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const [recurrences, tasks, workers] = await Promise.all([
      ctx.db.query("polyvalentTaskRecurrences").take(500),
      ctx.db.query("polyvalentTasks").take(500),
      ctx.db.query("polyvalentWorkers").take(500),
    ]);
    const taskById = new Map(tasks.map((task) => [String(task._id), task]));
    const workerById = new Map(workers.map((worker) => [String(worker._id), worker]));
    return recurrences.map((recurrence) => ({
      ...recurrence,
      taskName: taskById.get(String(recurrence.taskId))?.name ?? "Tâche supprimée",
      workerName: recurrence.workerId ? `${workerById.get(String(recurrence.workerId))?.firstName ?? ""} ${workerById.get(String(recurrence.workerId))?.lastName ?? ""}`.trim() || "Salarié supprimé" : "Aucun salarié affecté",
    }));
  },
});

export const createRecurrence = mutation({
  args: { taskId: v.id("polyvalentTasks"), workerId: v.optional(v.id("polyvalentWorkers")), slots: recurrenceSlotsValidator },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    if (args.slots.length === 0 || args.slots.length > 7) throw new Error("Choisissez entre un et sept créneaux hebdomadaires.");
    const days = new Set<number>();
    for (const slot of args.slots) {
      if (!Number.isInteger(slot.weekday) || slot.weekday < 1 || slot.weekday > 7 || days.has(slot.weekday) || !/^\d{2}:\d{2}$/.test(slot.start) || !/^\d{2}:\d{2}$/.test(slot.end) || slot.end <= slot.start) throw new Error("Les créneaux récurrents sont invalides.");
      days.add(slot.weekday);
    }
    const [task, worker] = await Promise.all([ctx.db.get(args.taskId), args.workerId ? ctx.db.get(args.workerId) : null]);
    if (!task) throw new Error("Tâche introuvable.");
    if (args.workerId && !worker) throw new Error("Salarié introuvable.");
    return await ctx.db.insert("polyvalentTaskRecurrences", { ...args, createdBy: formatUserName(identity), createdAt: Date.now() });
  },
});

export const deleteRecurrence = mutation({
  args: { id: v.id("polyvalentTaskRecurrences") },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
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
      const worker = activity.workerId ? workerById.get(String(activity.workerId)) ?? null : null;
      return {
        ...activity,
        taskName: task?.name ?? "Tâche supprimée",
        workerName: worker
          ? `${worker.firstName} ${worker.lastName}`.trim()
          : "Aucun salarié affecté",
      };
    });
  },
});

export const createActivity = mutation({
  args: {
    taskId: v.id("polyvalentTasks"),
    workerId: v.optional(v.id("polyvalentWorkers")),
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
    const [task, worker] = await Promise.all([ctx.db.get(args.taskId), args.workerId ? ctx.db.get(args.workerId) : null]);
    if (!task) throw new Error("Tâche introuvable.");
    if (args.workerId && !worker) throw new Error("Ouvrier introuvable.");
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

/**
 * Crée plusieurs créneaux indépendants en une seule opération.
 */
export const createActivities = mutation({
  args: {
    taskId: v.id("polyvalentTasks"),
    workerId: v.optional(v.id("polyvalentWorkers")),
    slots: v.array(v.object({ startAt: v.number(), endAt: v.number() })),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    if (args.slots.length === 0) throw new Error("Ajoutez au moins un créneau.");
    if (args.slots.length > 100) throw new Error("Une création est limitée à 100 créneaux.");
    for (const slot of args.slots) {
      if (!Number.isFinite(slot.startAt) || !Number.isFinite(slot.endAt) || slot.endAt <= slot.startAt) {
        throw new Error("Chaque créneau doit avoir une fin après son début.");
      }
    }
    const [task, worker] = await Promise.all([ctx.db.get(args.taskId), args.workerId ? ctx.db.get(args.workerId) : null]);
    if (!task) throw new Error("Tâche introuvable.");
    if (args.workerId && !worker) throw new Error("Ouvrier introuvable.");
    const createdBy = formatUserName(identity);
    const createdAt = Date.now();
    return await Promise.all(
      args.slots.map((slot) =>
        ctx.db.insert("polyvalentActivities", {
          taskId: args.taskId,
          workerId: args.workerId,
          ...slot,
          createdBy,
          createdAt,
        }),
      ),
    );
  },
});

export const updateActivity = mutation({
  args: {
    id: v.id("polyvalentActivities"),
    taskId: v.id("polyvalentTasks"),
    workerId: v.optional(v.id("polyvalentWorkers")),
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
    const [task, worker] = await Promise.all([ctx.db.get(args.taskId), args.workerId ? ctx.db.get(args.workerId) : null]);
    if (!task) throw new Error("Tâche introuvable.");
    if (args.workerId && !worker) throw new Error("Ouvrier introuvable.");
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
