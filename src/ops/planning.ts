import { z } from "zod";
import type { Row, Stmt } from "../db.ts";
import { OpError, ruleViolation } from "../errors.ts";
import { ulid } from "../ids.ts";
import { daysOfIsoWeek, isRealDay, weekdayOf } from "../services/calendar.ts";
import { defineOp, type OpContext, type OpDef } from "./registry.ts";
import { requireActiveRef } from "./entities.ts";
import { id, title } from "./helpers.ts";

const realDay = z.string().refine(isRealDay, "must be a real date, YYYY-MM-DD");
const isoWeek = z.string().refine((w) => daysOfIsoWeek(w) !== null, "must be an ISO week such as 2026-W48");
const dayType = z.enum(["work", "leave", "sick", "light"]);
const outcomeStatus = z.enum(["open", "met", "partly", "missed"]);

/** Available minutes for a day from the weekly template (0 when the weekday has no template row). */
async function templateMinutes(ctx: OpContext, day: string): Promise<number> {
  const row = await ctx.db.first<{ available_min: number }>("SELECT available_min FROM capacity_template WHERE weekday = ?", [weekdayOf(day)]);
  return row?.available_min ?? 0;
}

/** Load the day row, or describe the row that would be created from the template. */
async function loadDay(ctx: OpContext, day: string): Promise<{ before: Row | null; base: Row }> {
  const before = await ctx.db.first<Row>("SELECT * FROM days WHERE day = ?", [day]);
  const base = before ?? { day, available_min: await templateMinutes(ctx, day), day_type: "work", committed_at: null, plan_snapshot: null, closed_at: null };
  return { before, base };
}

function upsertDay(row: Row): Stmt {
  return {
    sql: `INSERT INTO days (day, available_min, day_type, committed_at, plan_snapshot, closed_at) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(day) DO UPDATE SET available_min = excluded.available_min, day_type = excluded.day_type,
            committed_at = excluded.committed_at, plan_snapshot = excluded.plan_snapshot, closed_at = excluded.closed_at`,
    params: [row.day as string, row.available_min as number, row.day_type as string, (row.committed_at as string) ?? null, (row.plan_snapshot as string) ?? null, (row.closed_at as string) ?? null],
  };
}

export const dayOps: OpDef[] = [
  defineOp({
    name: "day.set",
    tier: "A",
    description: "Override one day's available minutes or mark it as leave, sick or a light day (leave and sick days count as 0 minutes and are excluded from scores; a light day needs available_min). Saving the same values again changes nothing and returns no events.",
    input: z
      .object({ day: realDay, available_min: z.number().int().min(0).max(1440).optional(), day_type: dayType.optional() })
      .strict()
      .refine((v) => v.available_min !== undefined || v.day_type !== undefined, "give available_min or day_type"),
    async plan(ctx, input) {
      const { before, base } = await loadDay(ctx, input.day);
      if (base.closed_at) throw ruleViolation("day_closed", `${input.day} is closed`);
      const after: Row = { ...base, ...(input.available_min !== undefined && { available_min: input.available_min }), ...(input.day_type && { day_type: input.day_type }) };
      if (input.day_type === "light" && input.available_min === undefined && base.day_type !== "light") {
        throw new OpError("invalid_input", "a light day needs available_min", { fieldErrors: { available_min: ["required for a light day"] } });
      }
      if (before && after.available_min === before.available_min && after.day_type === before.day_type) {
        return { statements: [], changes: [], result: before }; // unchanged: no events
      }
      return { statements: [upsertDay(after)], changes: [{ entityType: "day", entityId: input.day, before, after }], result: after };
    },
  }),
  defineOp({
    name: "day.commit",
    tier: "A",
    description: "Commit the day's plan: freezes a snapshot of its planned tasks and priorities, used later for schedule adherence.",
    input: z.object({ day: realDay }).strict(),
    async plan(ctx, input) {
      const { before, base } = await loadDay(ctx, input.day);
      if (base.committed_at) throw new OpError("conflict", `${input.day} is already committed`);
      if (base.closed_at) throw ruleViolation("day_closed", `${input.day} is closed`);
      const tasks = await ctx.db.all<Row>(
        `SELECT id, title, workstream_id, project_id, estimate_min, is_priority, is_deliverable FROM tasks
          WHERE planned_day = ? AND archived_at IS NULL AND status IN ('todo','in_progress') ORDER BY id`,
        [input.day],
      );
      if (tasks.length === 0) throw ruleViolation("nothing_planned", `nothing is planned for ${input.day}`);
      const snapshot = {
        committed_at: ctx.now,
        available_min: base.available_min,
        day_type: base.day_type,
        priorities: tasks.filter((t) => t.is_priority).map((t) => t.id),
        tasks,
      };
      const after: Row = { ...base, committed_at: ctx.now, plan_snapshot: JSON.stringify(snapshot) };
      return { statements: [upsertDay(after)], changes: [{ entityType: "day", entityId: input.day, before, after }], result: { ...after, plan_snapshot: snapshot } };
    },
  }),
  defineOp({
    name: "day.uncommit",
    tier: "B",
    description: "Withdraw a day's commitment, only before any time block of that day has been submitted.",
    input: z.object({ day: realDay }).strict(),
    async plan(ctx, input) {
      const before = await ctx.db.first<Row>("SELECT * FROM days WHERE day = ?", [input.day]);
      if (!before?.committed_at) throw new OpError("conflict", `${input.day} is not committed`);
      if (before.closed_at) throw ruleViolation("day_closed", `${input.day} is closed`);
      const submitted = await ctx.db.first(
        "SELECT 1 AS x FROM block_submissions s JOIN time_blocks b ON b.id = s.block_id WHERE b.day = ? LIMIT 1",
        [input.day],
      );
      if (submitted) throw ruleViolation("blocks_submitted", "time blocks for this day have already been submitted");
      const after: Row = { ...before, committed_at: null, plan_snapshot: null };
      return { statements: [upsertDay(after)], changes: [{ entityType: "day", entityId: input.day, before, after }], result: after };
    },
  }),
] as OpDef[];

async function activeOutcome(ctx: OpContext, outcomeId: string): Promise<Row> {
  const row = await ctx.db.first<Row>("SELECT * FROM weekly_outcomes WHERE id = ? AND archived_at IS NULL", [outcomeId]);
  if (!row) throw new OpError("not_found", `weekly outcome ${outcomeId} not found`);
  return row;
}

export const weeklyOutcomeOps: OpDef[] = [
  defineOp({
    name: "weekly_outcome.set",
    tier: "B",
    description: "Set one of the week's three outcomes (Rule 3). Replaces the title and project of an existing slot.",
    input: z.object({ week: isoWeek, position: z.number().int().min(1).max(3), title, project_id: id.nullable().optional() }).strict(),
    async plan(ctx, input) {
      if (input.project_id) await requireActiveRef(ctx.db, "project", input.project_id, "project_id");
      const before = await ctx.db.first<Row>("SELECT * FROM weekly_outcomes WHERE week = ? AND position = ? AND archived_at IS NULL", [input.week, input.position]);
      if (before && before.title === input.title && (input.project_id === undefined || input.project_id === before.project_id)) {
        return { statements: [], changes: [], result: before }; // unchanged: no events
      }
      if (before) {
        const after: Row = { ...before, title: input.title, ...(input.project_id !== undefined && { project_id: input.project_id }) };
        return {
          statements: [{ sql: "UPDATE weekly_outcomes SET title = ?, project_id = ? WHERE id = ?", params: [after.title as string, (after.project_id as string) ?? null, before.id as string] }],
          changes: [{ entityType: "weekly_outcome", entityId: before.id as string, before, after }],
          result: after,
        };
      }
      const row: Row = { id: ulid(), week: input.week, position: input.position, title: input.title, project_id: input.project_id ?? null, status: "open", archived_at: null };
      return {
        statements: [{ sql: "INSERT INTO weekly_outcomes (id, week, position, title, project_id, status) VALUES (?, ?, ?, ?, ?, ?)", params: [row.id as string, row.week as string, row.position as number, row.title as string, row.project_id as string | null, "open"] }],
        changes: [{ entityType: "weekly_outcome", entityId: row.id as string, before: null, after: row }],
        result: row,
      };
    },
  }),
  defineOp({
    name: "weekly_outcome.set_status",
    tier: "A",
    description: "Mark a weekly outcome open, met, partly met or missed.",
    input: z.object({ id, status: outcomeStatus }).strict(),
    async plan(ctx, input) {
      const before = await activeOutcome(ctx, input.id);
      if (before.status === input.status) return { statements: [], changes: [], result: before }; // unchanged: no events
      const after = { ...before, status: input.status };
      return {
        statements: [{ sql: "UPDATE weekly_outcomes SET status = ? WHERE id = ?", params: [input.status, input.id] }],
        changes: [{ entityType: "weekly_outcome", entityId: input.id, before, after }],
        result: after,
      };
    },
  }),
  defineOp({
    name: "weekly_outcome.clear",
    tier: "B",
    description: "Empty an outcome slot that is still open (the outcome is archived, not deleted). Outcomes with a result cannot be cleared.",
    input: z.object({ id }).strict(),
    async plan(ctx, input) {
      const before = await activeOutcome(ctx, input.id);
      if (before.status !== "open") throw ruleViolation("outcome_scored", "only an open outcome can be cleared; its result is part of the record");
      return {
        statements: [{ sql: "UPDATE weekly_outcomes SET archived_at = ? WHERE id = ?", params: [ctx.now, input.id] }],
        changes: [{ entityType: "weekly_outcome", entityId: input.id, before, after: { ...before, archived_at: ctx.now } }],
        result: { ...before, archived_at: ctx.now },
      };
    },
  }),
] as OpDef[];
