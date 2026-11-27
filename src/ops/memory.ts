import { z } from "zod";
import type { Row } from "../db.ts";
import { OpError, ruleViolation } from "../errors.ts";
import { ulid } from "../ids.ts";
import { defineOp, type OpDef } from "./registry.ts";
import { columnDefaults, insertStmt, normalise, requireActiveRef } from "./entities.ts";
import { archiveOps, day, defined, flag, id, loadEditable, planCreate, planPatch, requireSomeField, slugify, text, title } from "./helpers.ts";

const ideaKind = z.enum(["idea", "possible_project", "opportunity"]);
const noteKind = z.enum(["blocker", "observation", "accomplishment", "priority_change"]);
const docPath = z
  .string()
  .regex(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.md$/, "must be a relative path ending in .md, e.g. brain/MASTER_CONTEXT.md")
  .max(200);

export const ideaOps: OpDef[] = [
  defineOp({
    name: "idea.capture",
    tier: "A",
    description: "Capture an idea in the backlog. Ideas never become tasks or projects until promoted (Rule 8).",
    input: z.object({ title, notes: text.optional(), kind: ideaKind.default("idea") }).strict(),
    async plan(ctx, input) {
      return planCreate(ctx, "idea", { ...input, status: "open", mention_count: 1 });
    },
  }),
  defineOp({
    name: "idea.update",
    tier: "A",
    description: "Edit an idea's title, notes or kind, or park or drop it.",
    input: z
      .object({ id, title: title.optional(), notes: text.nullable().optional(), kind: ideaKind.optional(), status: z.enum(["open", "parked", "dropped"]).optional() })
      .strict(),
    async plan(ctx, input) {
      requireSomeField(input);
      const before = await loadEditable(ctx, "idea", input.id);
      if (before.status === "promoted") throw ruleViolation("idea_promoted", "idea was already promoted");
      const { id: _id, ...patch } = input;
      return planPatch(ctx, "idea", before, defined(patch));
    },
  }),
  defineOp({
    name: "idea.mention",
    tier: "A",
    description: "Record that an idea came up again (feeds the inactivity challenge, Rule 5).",
    input: z.object({ id }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "idea", input.id);
      return planPatch(ctx, "idea", before, { mention_count: (before.mention_count as number) + 1 });
    },
  }),
  defineOp({
    name: "idea.promote",
    tier: "B",
    description: "Deliberately promote an idea to a task or a project.",
    input: z.discriminatedUnion("to", [
      z.object({ id, to: z.literal("task"), workstream_id: id, project_id: id.optional(), planned_day: day.optional(), estimate_min: z.number().int().min(1).max(1440).optional() }).strict(),
      z.object({ id, to: z.literal("project"), workstream_id: id, objective_id: id.optional(), priority: z.number().int().min(1).max(5).default(3) }).strict(),
    ]),
    async plan(ctx, input) {
      const idea = await loadEditable(ctx, "idea", input.id);
      if (idea.status === "promoted") throw new OpError("conflict", "idea was already promoted");
      await requireActiveRef(ctx.db, "workstream", input.workstream_id, "workstream_id");
      const newId = ulid();
      let target: Row;
      if (input.to === "task") {
        await requireActiveRef(ctx.db, "project", input.project_id, "project_id");
        target = normalise({
          ...(await columnDefaults(ctx.db, "task")),
          id: newId,
          title: idea.title,
          notes: idea.notes,
          workstream_id: input.workstream_id,
          project_id: input.project_id,
          planned_day: input.planned_day,
          estimate_min: input.estimate_min,
          status: "todo",
          source: ctx.actor === "user" ? "user" : ctx.actor,
          created_at: ctx.now,
          updated_at: ctx.now,
        });
      } else {
        await requireActiveRef(ctx.db, "objective", input.objective_id, "objective_id");
        let slug = slugify(idea.title as string);
        for (let n = 2; await ctx.db.first("SELECT 1 AS x FROM projects WHERE slug = ?", [slug]); n++) slug = `${slugify(idea.title as string)}-${n}`;
        target = normalise({
          ...(await columnDefaults(ctx.db, "project")),
          id: newId,
          slug,
          title: idea.title,
          description: idea.notes,
          workstream_id: input.workstream_id,
          objective_id: input.objective_id,
          priority: input.priority,
          status: "active",
          last_activity_at: ctx.now,
          created_at: ctx.now,
          updated_at: ctx.now,
        });
      }
      const ideaPatch = planPatch(ctx, "idea", idea, { status: "promoted", promoted_to_type: input.to, promoted_to_id: newId });
      return {
        statements: [insertStmt(input.to, target), ...ideaPatch.statements],
        changes: [{ entityType: input.to, entityId: newId, before: null, after: target }, ...ideaPatch.changes],
        result: { idea: ideaPatch.result, [input.to]: target },
      };
    },
  }),
  ...archiveOps("idea"),
] as OpDef[];

export const decisionOps: OpDef[] = [
  defineOp({
    name: "decision.log",
    tier: "A",
    description: "Record a decision, optionally for a project. Decisions are never edited, only superseded.",
    input: z.object({ title, rationale: text.optional(), project_id: id.optional(), day: day.optional() }).strict(),
    async plan(ctx, input) {
      await requireActiveRef(ctx.db, "project", input.project_id, "project_id");
      return planCreate(ctx, "decision", { ...input, day: input.day ?? ctx.day });
    },
  }),
  defineOp({
    name: "decision.supersede",
    tier: "A",
    description: "Record a new decision that replaces an earlier one; the earlier one is kept.",
    input: z.object({ supersedes_id: id, title, rationale: text.optional() }).strict(),
    async plan(ctx, input) {
      const old = await loadEditable(ctx, "decision", input.supersedes_id);
      const already = await ctx.db.first("SELECT id FROM decisions WHERE supersedes_id = ? AND archived_at IS NULL", [input.supersedes_id]);
      if (already) throw new OpError("conflict", "that decision has already been superseded");
      return planCreate(ctx, "decision", { ...input, project_id: old.project_id, day: ctx.day });
    },
  }),
  ...archiveOps("decision"),
] as OpDef[];

export const noteOps: OpDef[] = [
  defineOp({
    name: "note.add",
    tier: "A",
    description: "Add a blocker, observation, accomplishment or priority change for today, optionally for a project.",
    input: z.object({ kind: noteKind, body: z.string().trim().min(1).max(20_000), project_id: id.optional(), day: day.optional() }).strict(),
    async plan(ctx, input) {
      await requireActiveRef(ctx.db, "project", input.project_id, "project_id");
      return planCreate(ctx, "note", { ...input, day: input.day ?? ctx.day });
    },
  }),
  defineOp({
    name: "note.update",
    tier: "A",
    description: "Correct a note's text. The original stays in the event history.",
    input: z.object({ id, body: z.string().trim().min(1).max(20_000) }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "note", input.id);
      return planPatch(ctx, "note", before, { body: input.body });
    },
  }),
  defineOp({
    name: "note.resolve",
    tier: "A",
    description: "Mark a blocker (or any note) resolved, or reopen it.",
    input: z.object({ id, resolved: flag.default(true) }).strict(),
    async plan(ctx, input) {
      const before = await loadEditable(ctx, "note", input.id);
      if (Boolean(before.resolved_at) === input.resolved) throw new OpError("conflict", input.resolved ? "already resolved" : "not resolved");
      return planPatch(ctx, "note", before, { resolved_at: input.resolved ? ctx.now : null });
    },
  }),
  ...archiveOps("note"),
] as OpDef[];

export const documentOps: OpDef[] = [
  defineOp({
    name: "document.put",
    tier: "A",
    description:
      "Create or replace an authored Markdown document (brain files, project narratives). Every version is kept. When the caller is the AI this is Tier B (a proposed diff).",
    input: z.object({ path: docPath, body: z.string().max(200_000), expected_version: z.number().int().min(1).optional() }).strict(),
    async plan(ctx, input) {
      const before = await ctx.db.first<Row>("SELECT * FROM documents WHERE path = ?", [input.path]);
      if (input.expected_version !== undefined && (before?.version ?? 0) !== input.expected_version) {
        throw new OpError("conflict", `document is at version ${before?.version ?? 0}, not ${input.expected_version}`);
      }
      if (before?.archived_at) throw ruleViolation("archived", "document is archived; unarchive it first");
      if (before && before.body === input.body) throw new OpError("conflict", "no change to the document");
      const version = ((before?.version as number | undefined) ?? 0) + 1;
      const docId = (before?.id as string | undefined) ?? ulid();
      const versionRow = { sql: "INSERT INTO document_versions (document_id, version, body, actor, created_at) VALUES (?, ?, ?, ?, ?)", params: [docId, version, input.body, ctx.actor, ctx.now] };
      if (!before) {
        const row = normalise({ ...(await columnDefaults(ctx.db, "document")), id: docId, path: input.path, body: input.body, version, created_at: ctx.now, updated_at: ctx.now, updated_by: ctx.actor });
        return { statements: [insertStmt("document", row), versionRow], changes: [{ entityType: "document", entityId: docId, before: null, after: row }], result: row };
      }
      const plan = planPatch(ctx, "document", before, { body: input.body, version, updated_by: ctx.actor });
      return { ...plan, statements: [...plan.statements, versionRow] };
    },
  }),
  ...archiveOps("document"),
] as OpDef[];
