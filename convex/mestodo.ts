import { v } from "convex/values";
import { action, env, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  accessAllows,
  fetchInternalClerkDirectory,
  formatUserName,
  requireCrmPermission,
  requireUser,
} from "./lib";

const PAGE_KEY = "mestodo:projets";

const projectStatus = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("archived"),
);

const taskStatus = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("done"),
);

const taskPriority = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("urgent"),
);

const assignee = v.object({
  clerkId: v.string(),
  name: v.string(),
  imageUrl: v.optional(v.string()),
});

function requiredText(value: string, label: string, maxLength: number) {
  const text = value.trim();
  if (!text) throw new Error(`${label} requis.`);
  if (text.length > maxLength) throw new Error(`${label} trop long.`);
  return text;
}

function optionalText(value: string | null | undefined, maxLength: number) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = value.trim();
  if (text.length > maxLength) throw new Error("Texte trop long.");
  return text || null;
}

function optionalDate(value: number | null | undefined) {
  if (value === undefined || value === null) return value;
  if (!Number.isFinite(value)) throw new Error("Date invalide.");
  return value;
}

function cleanAssignees(
  values: Array<{ clerkId: string; name: string; imageUrl?: string }>,
) {
  if (values.length > 20) throw new Error("20 responsables maximum par tâche.");
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const clerkId = value.clerkId.trim();
    const name = value.name.trim();
    if (!clerkId || !name || seen.has(clerkId)) return [];
    seen.add(clerkId);
    return [{
      clerkId,
      name,
      imageUrl: value.imageUrl?.trim() || undefined,
    }];
  });
}

async function projectOrThrow(ctx: QueryCtx | MutationCtx, id: Id<"todoProjects">) {
  const project = await ctx.db.get(id);
  if (!project) throw new Error("Projet introuvable.");
  return project;
}

export const listProjects = query({
  args: { status: v.optional(projectStatus) },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    if (args.status) {
      return await ctx.db
        .query("todoProjects")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(200);
    }
    return await ctx.db.query("todoProjects").withIndex("by_updatedAt").order("desc").take(200);
  },
});

export const getProject = query({
  args: { projectId: v.id("todoProjects") },
  handler: async (ctx, { projectId }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "read");
    const project = await ctx.db.get(projectId);
    if (!project) return null;
    const [tasks, notes] = await Promise.all([
      ctx.db.query("todoTasks").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(500),
      ctx.db.query("todoNotes").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).order("desc").take(500),
    ]);
    return {
      project,
      tasks: tasks.sort((a, b) => a.position - b.position || b.createdAt - a.createdAt),
      notes,
    };
  },
});

export const createProject = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const now = Date.now();
    return await ctx.db.insert("todoProjects", {
      title: requiredText(args.title, "Nom du projet", 120),
      description: optionalText(args.description, 2_000) ?? undefined,
      status: "active",
      color: args.color?.trim() || undefined,
      dueAt: optionalDate(args.dueAt) ?? undefined,
      taskCount: 0,
      completedTaskCount: 0,
      createdByClerkId: identity.subject,
      createdByName: formatUserName(identity),
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateProject = mutation({
  args: {
    projectId: v.id("todoProjects"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    status: v.optional(projectStatus),
    color: v.optional(v.union(v.string(), v.null())),
    dueAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    await projectOrThrow(ctx, args.projectId);
    const patch: {
      title?: string;
      description?: string;
      status?: "active" | "completed" | "archived";
      color?: string;
      dueAt?: number;
      updatedAt: number;
    } = { updatedAt: Date.now() };
    if (args.title !== undefined) patch.title = requiredText(args.title, "Nom du projet", 120);
    const description = optionalText(args.description, 2_000);
    if (description !== undefined) patch.description = description ?? undefined;
    if (args.status !== undefined) patch.status = args.status;
    if (args.color !== undefined) patch.color = args.color?.trim() || undefined;
    const dueAt = optionalDate(args.dueAt);
    if (dueAt !== undefined) patch.dueAt = dueAt ?? undefined;
    await ctx.db.patch(args.projectId, patch);
  },
});

export const removeProject = mutation({
  args: { projectId: v.id("todoProjects") },
  handler: async (ctx, { projectId }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    await projectOrThrow(ctx, projectId);
    const [tasks, notes] = await Promise.all([
      ctx.db.query("todoTasks").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(1_000),
      ctx.db.query("todoNotes").withIndex("by_projectId", (q) => q.eq("projectId", projectId)).take(1_000),
    ]);
    for (const note of notes) await ctx.db.delete(note._id);
    for (const task of tasks) await ctx.db.delete(task._id);
    await ctx.db.delete(projectId);
  },
});

export const createTask = mutation({
  args: {
    projectId: v.id("todoProjects"),
    title: v.string(),
    description: v.optional(v.string()),
    priority: taskPriority,
    assignees: v.array(assignee),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    const project = await projectOrThrow(ctx, args.projectId);
    const now = Date.now();
    const id = await ctx.db.insert("todoTasks", {
      projectId: args.projectId,
      title: requiredText(args.title, "Titre de la tâche", 180),
      description: optionalText(args.description, 4_000) ?? undefined,
      status: "todo",
      priority: args.priority,
      assignees: cleanAssignees(args.assignees),
      dueAt: optionalDate(args.dueAt) ?? undefined,
      position: now,
      createdByClerkId: identity.subject,
      createdByName: formatUserName(identity),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.projectId, {
      taskCount: project.taskCount + 1,
      updatedAt: now,
    });
    return id;
  },
});

export const updateTask = mutation({
  args: {
    taskId: v.id("todoTasks"),
    title: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    status: v.optional(taskStatus),
    priority: v.optional(taskPriority),
    assignees: v.optional(v.array(assignee)),
    dueAt: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Tâche introuvable.");
    const now = Date.now();
    const patch: {
      title?: string;
      description?: string;
      status?: "todo" | "in_progress" | "done";
      priority?: "low" | "medium" | "high" | "urgent";
      assignees?: Array<{ clerkId: string; name: string; imageUrl?: string }>;
      dueAt?: number;
      completedAt?: number;
      updatedAt: number;
    } = { updatedAt: now };
    if (args.title !== undefined) patch.title = requiredText(args.title, "Titre de la tâche", 180);
    const description = optionalText(args.description, 4_000);
    if (description !== undefined) patch.description = description ?? undefined;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.assignees !== undefined) patch.assignees = cleanAssignees(args.assignees);
    const dueAt = optionalDate(args.dueAt);
    if (dueAt !== undefined) patch.dueAt = dueAt ?? undefined;
    if (args.status !== undefined && args.status !== task.status) {
      patch.status = args.status;
      patch.completedAt = args.status === "done" ? now : undefined;
      const project = await projectOrThrow(ctx, task.projectId);
      const delta = args.status === "done" ? 1 : task.status === "done" ? -1 : 0;
      await ctx.db.patch(task.projectId, {
        completedTaskCount: Math.max(0, project.completedTaskCount + delta),
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(task.projectId, { updatedAt: now });
    }
    await ctx.db.patch(args.taskId, patch);
  },
});

export const removeTask = mutation({
  args: { taskId: v.id("todoTasks") },
  handler: async (ctx, { taskId }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    const task = await ctx.db.get(taskId);
    if (!task) throw new Error("Tâche introuvable.");
    const project = await projectOrThrow(ctx, task.projectId);
    const notes = await ctx.db.query("todoNotes").withIndex("by_taskId", (q) => q.eq("taskId", taskId)).take(500);
    for (const note of notes) await ctx.db.delete(note._id);
    await ctx.db.delete(taskId);
    await ctx.db.patch(task.projectId, {
      taskCount: Math.max(0, project.taskCount - 1),
      completedTaskCount: Math.max(0, project.completedTaskCount - (task.status === "done" ? 1 : 0)),
      updatedAt: Date.now(),
    });
  },
});

export const addNote = mutation({
  args: {
    projectId: v.id("todoProjects"),
    taskId: v.optional(v.id("todoTasks")),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "create");
    const identity = await requireUser(ctx);
    await projectOrThrow(ctx, args.projectId);
    if (args.taskId) {
      const task = await ctx.db.get(args.taskId);
      if (!task || task.projectId !== args.projectId) throw new Error("Tâche introuvable.");
    }
    const now = Date.now();
    const id = await ctx.db.insert("todoNotes", {
      projectId: args.projectId,
      taskId: args.taskId,
      body: requiredText(args.body, "Note", 5_000),
      authorClerkId: identity.subject,
      authorName: formatUserName(identity),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.projectId, { updatedAt: now });
    return id;
  },
});

export const updateNote = mutation({
  args: { noteId: v.id("todoNotes"), body: v.string() },
  handler: async (ctx, args) => {
    await requireCrmPermission(ctx, PAGE_KEY, "update");
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new Error("Note introuvable.");
    const now = Date.now();
    await ctx.db.patch(args.noteId, {
      body: requiredText(args.body, "Note", 5_000),
      updatedAt: now,
    });
    await ctx.db.patch(note.projectId, { updatedAt: now });
  },
});

export const removeNote = mutation({
  args: { noteId: v.id("todoNotes") },
  handler: async (ctx, { noteId }) => {
    await requireCrmPermission(ctx, PAGE_KEY, "delete");
    const note = await ctx.db.get(noteId);
    if (!note) throw new Error("Note introuvable.");
    await ctx.db.delete(noteId);
    await ctx.db.patch(note.projectId, { updatedAt: Date.now() });
  },
});

/** Annuaire interne Clerk de production pour l'affectation des tâches. */
export const listDirectory = action({
  args: {},
  handler: async (ctx): Promise<Array<{ clerkId: string; name: string; imageUrl: string | null }>> => {
    const access = await ctx.runQuery(api.permissions.myAccess, {});
    if (!accessAllows(access, PAGE_KEY, "read")) {
      throw new Error("Accès insuffisant à Mes Todo.");
    }
    const identity = await requireUser(ctx);
    const secret = env.CLERK_SECRET_KEY;
    if (!secret) throw new Error("Annuaire indisponible.");
    const directory = await fetchInternalClerkDirectory(secret, access.email ?? "");
    directory.push({
      clerkId: identity.subject,
      name: formatUserName(identity),
      imageUrl: identity.pictureUrl ?? null,
    });
    return directory.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  },
});
