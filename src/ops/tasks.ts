import { z } from "zod";
import type { Row, Stmt } from "../db.ts";
import { OpError } from "../errors.ts";
import { DUPLICATE_THRESHOLD, similarity } from "../services/similarity.ts";
import { defineOp, type OpContext, type OpDef, type OpPlan } from "./registry.ts";
import { dependencyId, requireActiveRef } from "./entities.ts";
import { archiveOps, day, defined, flag, id, loadEditable, planCreate, planPatch, requireSomeField, text, title } from "./helpers.ts";

export const MAX_DAILY_PRIORITIES = 3;
const status = z.enum(["todo", "in_progress", "done", "dropped", "backlog"]);
const estimate = z.number().int().min(1).max(1440);
const OPEN = ["todo", "in_progress", "backlog"];

/** Validate the links a task points at: workstream, project, milestone (must belong to the project), parent task. */
async function checkLinks(ctx: OpContext, t: Row): Promise<void> {
  await requireActiveRef(ctx.db, "workstream", t.workstream_id as string, "workstream_id");
  await requireActiveRef(ctx.db, "project", t.project_id as string | null, "project_id");
  const ms = await requireActiveRef(ctx.db, "milestone", t.milestone_id as string | null, "milestone_id");
  if (ms && ms.project_id !== t.project_id) {
    throw new OpError("rule_violation", "milestone_id belongs to a different project than project_id");
  }
  if (t.parent_task_id != null) {
    if (t.parent_task_id === t.id) throw new OpError("rule_violation", "a task cannot be its own parent");
    await requireActiveRef(ctx.db, "task", t.parent_task_id as string, "parent_task_id");
  }
}

/** Rule 2: at most three priorities per day. */
async function checkPriorityCap(ctx: OpContext, t: Row): Promise<void> {
  if (!t.is_priority || !t.planned_day || !OPEN.includes(t.status as string)) return;
  const row = await ctx.db.first<{ n: number }>(
    `SELECT count(*) AS n FROM tasks WHERE is_priority = 1 AND planned_day = ? AND id <> ?
       AND archived_at IS NULL AND status IN ('todo','in_progress','backlog')`,
    [t.planned_day as string, (t.id as string) ?? ""],
  );
  if ((row?.n ?? 0) >= MAX_DAILY_PRIORITIES) {
    throw new OpError("rule_violation", `${t.planned_day} already has ${MAX_DAILY_PRIORITIES} priorities`);
  }
}

/** Duplicate protection: an open task in the same project (or the same workstream, if no project) with a near-identical title. */
async function findDuplicate(ctx: OpContext, t: Row): Promise<Row | null> {
  const candidates = await ctx.db.all<Row>(
    t.project_id
      ? "SELECT id, title FROM tasks WHERE project_id = ? AND archived_at IS NULL AND status IN ('todo','in_progress','backlog')"
      : "SELECT id, title FROM tasks WHERE project_id IS NULL AND workstream_id = ? AND archived_at IS NULL AND status IN ('todo','in_progress','backlog')",
    [(t.project_id ?? t.workstream_id) as string],
  );
  let best: Row | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = similarity(t.title as string, c.title as string);
    if (score >= DUPLICATE_THRESHOLD && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function touchProject(ctx: OpContext, projectId: unknown): Stmt[] {
  return projectId ? [{ sql: "UPDATE projects SET last_activity_at = ? WHERE id = ?", params: [ctx.now, projectId as string] }] : [];
}

function withProjectTouch(ctx: OpContext, plan: OpPlan<Row>, ...projectIds: unknown[]): OpPlan<Row> {
  const ids = [...new Set(projectIds.filter(Boolean))];
  return { ...plan, statements: [...plan.statements, ...ids.flatMap((p) => touchProject(ctx, p))] };
}

const createInput = z
  .object({
    title,
    notes: text.optional(),
    workstream_id: id,
    project_id: id.optional(),
    milestone_id: id.optional(),
    parent_task_id: id.optional(),
    status: z.enum(["todo", "backlog"]).default("todo"),
    estimate_min: estimate.optional(),
    planned_day: day.optional(),
    due_day: day.optional(),
    is_deliverable: flag.default(false),
    is_priority: flag.default(false),
    source: z.enum(["user", "ai", "quick_add", "automation", "agent"]).optional(),
    allow_duplicate: flag.default(false),
  })
  .strict();

export const taskOps: OpDef[] = [
  defineOp({
    name: "task.create",
    tier: "A",
    description:
      "Create a task. Refused as a duplicate if an open task with a near-identical title exists in the same project (pass allow_duplicate to override). Tier B when scheduled, a deliverable or with a deadline (the tier is decided per call).",
    input: createInput,
    async plan(ctx, input) {
      const { allow_duplicate, ...fields } = input;
      const row: Row = { ...fields, source: fields.source ?? (ctx.actor === "user" ? "user" : ctx.actor) };
      await checkLinks(ctx, row);
      await checkPriorityCap(ctx, row);
      if (!allow_duplicate) {
        const dup = await findDuplicate(ctx, row);
        if (dup) throw new OpError("duplicate", `a similar open task exists: "${dup.title}"`, { task_id: dup.id });
      }
      return withProjectTouch(ctx, await planCreate(ctx, "task", row), row.project_id);
    },
  }),
  defineOp({
    name: "task.update",
    tier: "A",
    description:
      "Edit a task. Moving planned_day later than its current day counts as a postponement. Use task.complete / task.reopen for completion.",
    input: z
      .object({
        id,
        title: title.optional(),
        notes: text.nullable().optional(),
        workstream_id: id.optional(),
        project_id: id.nullable().optional(),
        milestone_id: id.nullable().optional(),
        parent_task_id: id.nullable().optional(),
        status: z.enum(["todo", "in_progress", "backlog", "dropped"]).optional(),
        estimate_min: estimate.nullable().optional(),
        planned_day: day.nullable().optional(),
        due_day: day.nullable().optional(),
        is_deliverable: flag.optional(),
        is_priority: flag.optional(),
      })
      .strict(),
    async plan(ctx, input) {
      requireSomeField(input);
      const before = await loadEditable(ctx, "task", input.id);
      if (before.status === "done" && input.status) {
        throw new OpError("rule_violation", "task is done; use task.reopen first");
      }
      const { id: _id, ...rest } = input;
      const patch = defined(rest);
      if (patch.project_id === null && before.milestone_id && patch.milestone_id === undefined) patch.milestone_id = null;
      const merged = { ...before, ...patch };
      if (["workstream_id", "project_id", "milestone_id", "parent_task_id"].some((k) => k in patch)) await checkLinks(ctx, merged);
      if ("is_priority" in patch || "planned_day" in patch || "status" in patch) await checkPriorityCap(ctx, merged);
      const oldDay = before.planned_day as string | null;
      const newDay = patch.planned_day as string | null | undefined;
      // Rule 4 bookkeeping: moving work to a later day, or off the plan, is a postponement.
      if (oldDay && newDay !== undefined && (newDay === null || newDay > oldDay)) {
        patch.postpone_count = (before.postpone_count as number) + 1;
      }
      return withProjectTouch(ctx, planPatch(ctx, "task", before, patch), before.project_id, merged.project_id);
    },
  }),
  defineOp({
    name: "task.complete",
    tier: "A",
    description: "Mark a task done.",
    input: z.object({ id }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "task", input.id);
      if (before.status === "done") throw new OpError("conflict", "task is already done");
      return withProjectTouch(ctx, planPatch(ctx, "task", before, { status: "done", done_at: ctx.now }), before.project_id);
    },
  }),
  defineOp({
    name: "task.reopen",
    tier: "A",
    description: "Reopen a done or dropped task.",
    input: z.object({ id }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "task", input.id);
      if (!["done", "dropped"].includes(before.status as string)) throw new OpError("conflict", "task is not done or dropped");
      const merged = { ...before, status: "todo" };
      await checkPriorityCap(ctx, merged);
      return withProjectTouch(ctx, planPatch(ctx, "task", before, { status: "todo", done_at: null }), before.project_id);
    },
  }),
  defineOp({
    name: "task.add_dependency",
    tier: "A",
    description: "Record that a task cannot start until another task is done.",
    input: z.object({ task_id: id, depends_on_id: id }).strict(),
    async plan(ctx, input) {
      if (input.task_id === input.depends_on_id) throw new OpError("rule_violation", "a task cannot depend on itself");
      await loadEditable(ctx, "task", input.task_id);
      await requireActiveRef(ctx.db, "task", input.depends_on_id, "depends_on_id");
      const exists = await ctx.db.first("SELECT 1 AS x FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?", [input.task_id, input.depends_on_id]);
      if (exists) throw new OpError("conflict", "dependency already recorded");
      // Refuse cycles: depends_on_id must not (transitively) depend on task_id.
      const reach = await ctx.db.first<{ x: number }>(
        `WITH RECURSIVE up(id) AS (SELECT depends_on_id FROM task_dependencies WHERE task_id = ?
           UNION SELECT d.depends_on_id FROM task_dependencies d JOIN up ON d.task_id = up.id)
         SELECT 1 AS x FROM up WHERE id = ? LIMIT 1`,
        [input.depends_on_id, input.task_id],
      );
      if (reach) throw new OpError("rule_violation", "that dependency would create a cycle");
      const row = { task_id: input.task_id, depends_on_id: input.depends_on_id };
      return {
        statements: [{ sql: "INSERT INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)", params: [row.task_id, row.depends_on_id] }],
        changes: [{ entityType: "task_dependency", entityId: dependencyId(row), before: null, after: row }],
        result: row,
      };
    },
  }),
  defineOp({
    name: "task.remove_dependency",
    tier: "A",
    description: "Remove a dependency between two tasks.",
    input: z.object({ task_id: id, depends_on_id: id }).strict(),
    async plan(_ctx, input) {
      const exists = await _ctx.db.first("SELECT 1 AS x FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?", [input.task_id, input.depends_on_id]);
      if (!exists) throw new OpError("not_found", "no such dependency");
      const row = { task_id: input.task_id, depends_on_id: input.depends_on_id };
      return {
        statements: [{ sql: "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?", params: [row.task_id, row.depends_on_id] }],
        changes: [{ entityType: "task_dependency", entityId: dependencyId(row), before: row, after: null }],
        result: row,
      };
    },
  }),
  ...archiveOps("task"),
] as OpDef[];
