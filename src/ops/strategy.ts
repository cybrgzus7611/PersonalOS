import { z } from "zod";
import type { Db } from "../db.ts";
import { OpError } from "../errors.ts";
import { defineOp, type OpDef } from "./registry.ts";
import { requireActiveRef } from "./entities.ts";
import { archiveOps, day, defined, id, loadEditable, planCreate, planPatch, requireSomeField, slugify, text, title } from "./helpers.ts";

const objectiveStatus = z.enum(["active", "achieved", "dropped"]);
const horizon = z.enum(["quarter", "year", "multi_year"]);
const projectStatus = z.enum(["active", "paused", "blocked", "done", "abandoned"]);
const priority = z.number().int().min(1).max(5);
const milestoneStatus = z.enum(["open", "done", "dropped"]);

async function uniqueSlug(db: Db, base: string, exceptId?: string): Promise<string> {
  let slug = slugify(base);
  for (let n = 2; ; n++) {
    const clash = await db.first<{ id: string }>("SELECT id FROM projects WHERE slug = ?", [slug]);
    if (!clash || clash.id === exceptId) return slug;
    slug = `${slugify(base)}-${n}`;
  }
}

export const objectiveOps: OpDef[] = [
  defineOp({
    name: "objective.create",
    tier: "B",
    description: "Create a long-term objective (a desired outcome that projects serve).",
    input: z.object({ title, description: text.optional(), horizon: horizon.optional() }).strict(),
    async plan(ctx, input) {
      return planCreate(ctx, "objective", { ...input, status: "active" });
    },
  }),
  defineOp({
    name: "objective.update",
    tier: "B",
    description: "Change an objective's title, description, horizon or status.",
    input: z
      .object({ id, title: title.optional(), description: text.nullable().optional(), horizon: horizon.nullable().optional(), status: objectiveStatus.optional() })
      .strict(),
    async plan(ctx, input) {
      requireSomeField(input);
      const before = await loadEditable(ctx, "objective", input.id);
      const { id: _id, ...patch } = input;
      return planPatch(ctx, "objective", before, defined(patch));
    },
  }),
  ...archiveOps("objective", "B"),
] as OpDef[];

const projectFields = {
  title,
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60),
  description: text,
  objective_id: id,
  workstream_id: id,
  client_name: z.string().trim().max(200),
  status: projectStatus,
  priority,
  due_day: day,
  health_note: z.string().max(2000),
};

export const projectOps: OpDef[] = [
  defineOp({
    name: "project.create",
    tier: "B",
    description: "Create a project under a workstream, optionally linked to an objective.",
    input: z
      .object({
        title: projectFields.title,
        slug: projectFields.slug.optional(),
        description: projectFields.description.optional(),
        objective_id: projectFields.objective_id.optional(),
        workstream_id: projectFields.workstream_id,
        client_name: projectFields.client_name.optional(),
        priority: projectFields.priority.default(3),
        due_day: projectFields.due_day.optional(),
      })
      .strict(),
    async plan(ctx, input) {
      await requireActiveRef(ctx.db, "workstream", input.workstream_id, "workstream_id");
      await requireActiveRef(ctx.db, "objective", input.objective_id, "objective_id");
      if (input.slug) {
        const clash = await ctx.db.first("SELECT id FROM projects WHERE slug = ?", [input.slug]);
        if (clash) throw new OpError("duplicate", `slug ${input.slug} is taken`);
      }
      const slug = input.slug ?? (await uniqueSlug(ctx.db, input.title));
      return planCreate(ctx, "project", { ...input, slug, status: "active", last_activity_at: ctx.now });
    },
  }),
  defineOp({
    name: "project.update",
    tier: "A",
    description: "Edit a project's details. Status and priority changes are Tier B and use project.set_status / project.set_priority.",
    input: z
      .object({
        id,
        title: projectFields.title.optional(),
        slug: projectFields.slug.optional(),
        description: projectFields.description.nullable().optional(),
        objective_id: projectFields.objective_id.nullable().optional(),
        workstream_id: projectFields.workstream_id.optional(),
        client_name: projectFields.client_name.nullable().optional(),
        health_note: projectFields.health_note.nullable().optional(),
      })
      .strict(),
    async plan(ctx, input) {
      requireSomeField(input);
      const before = await loadEditable(ctx, "project", input.id);
      if (input.workstream_id) await requireActiveRef(ctx.db, "workstream", input.workstream_id, "workstream_id");
      if (input.objective_id) await requireActiveRef(ctx.db, "objective", input.objective_id, "objective_id");
      if (input.slug && input.slug !== before.slug) {
        const clash = await ctx.db.first("SELECT id FROM projects WHERE slug = ?", [input.slug]);
        if (clash) throw new OpError("duplicate", `slug ${input.slug} is taken`);
      }
      const { id: _id, ...patch } = input;
      return planPatch(ctx, "project", before, defined(patch));
    },
  }),
  defineOp({
    name: "project.set_status",
    tier: "B",
    description: "Change a project's status (active, paused, blocked, done, abandoned).",
    input: z.object({ id, status: projectStatus }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "project", input.id);
      if (before.status === input.status) throw new OpError("conflict", `project is already ${input.status}`);
      return planPatch(ctx, "project", before, { status: input.status });
    },
  }),
  defineOp({
    name: "project.set_priority",
    tier: "B",
    description: "Change a project's priority (1 = highest, 5 = lowest).",
    input: z.object({ id, priority }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "project", input.id);
      return planPatch(ctx, "project", before, { priority: input.priority });
    },
  }),
  defineOp({
    name: "project.set_due_day",
    tier: "B",
    description: "Set or clear a project's deadline.",
    input: z.object({ id, due_day: day.nullable() }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "project", input.id);
      return planPatch(ctx, "project", before, { due_day: input.due_day });
    },
  }),
  ...archiveOps("project", "B"),
] as OpDef[];

export const milestoneOps: OpDef[] = [
  defineOp({
    name: "milestone.create",
    tier: "B",
    description: "Add a milestone to a project.",
    input: z.object({ project_id: id, title, due_day: day.optional() }).strict(),
    async plan(ctx, input) {
      await requireActiveRef(ctx.db, "project", input.project_id, "project_id");
      return planCreate(ctx, "milestone", { ...input, status: "open" });
    },
  }),
  defineOp({
    name: "milestone.update",
    tier: "A",
    description: "Rename a milestone.",
    input: z.object({ id, title }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "milestone", input.id);
      return planPatch(ctx, "milestone", before, { title: input.title });
    },
  }),
  defineOp({
    name: "milestone.set_due_day",
    tier: "B",
    description: "Set or clear a milestone's due day.",
    input: z.object({ id, due_day: day.nullable() }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "milestone", input.id);
      return planPatch(ctx, "milestone", before, { due_day: input.due_day });
    },
  }),
  defineOp({
    name: "milestone.set_status",
    tier: "A",
    description: "Mark a milestone open, done or dropped.",
    input: z.object({ id, status: milestoneStatus }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "milestone", input.id);
      if (before.status === input.status) throw new OpError("conflict", `milestone is already ${input.status}`);
      return planPatch(ctx, "milestone", before, { status: input.status, done_at: input.status === "done" ? ctx.now : null });
    },
  }),
  ...archiveOps("milestone"),
] as OpDef[];
