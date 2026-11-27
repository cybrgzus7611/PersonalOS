/**
 * Response shapes of the M2 read endpoints (docs/handoff/M2-frontend.md section 4).
 * The contract tests check live responses and the committed fixtures against these schemas,
 * so the handoff, the code and the fixtures cannot drift apart silently.
 */
import { z } from "zod";

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const week = z.string().regex(/^\d{4}-W\d{2}$/);
const iso = z.string().min(20);
const bit = z.union([z.literal(0), z.literal(1)]);
const load = z.enum(["ok", "high", "over", "off"]);
const dayType = z.enum(["work", "leave", "sick", "light"]);

export const taskCard = z
  .object({
    id: ulid,
    title: z.string(),
    workstream_id: ulid,
    project_id: ulid.nullable(),
    milestone_id: ulid.nullable(),
    status: z.enum(["todo", "in_progress", "done", "dropped", "backlog"]),
    estimate_min: z.number().int().nullable(),
    planned_day: day.nullable(),
    due_day: day.nullable(),
    is_priority: bit,
    is_deliverable: bit,
    postpone_count: z.number().int(),
    done_at: iso.nullable(),
    created_at: iso,
  })
  .strict();

export const workstreamRef = z
  .object({
    id: ulid,
    name: z.string(),
    colour: z.string(),
    daily_target_min: z.number().int(),
    is_core: bit,
    sort_order: z.number().int(),
    archived_at: iso.nullable(),
  })
  .strict();

export const projectRef = z
  .object({ id: ulid, slug: z.string(), title: z.string(), status: z.string(), workstream_id: ulid, archived_at: iso.nullable() })
  .strict();
const projectMap = z.record(ulid, projectRef);

export const todayResponse = z.object({ day, week, weekday: z.number().int().min(0).max(6), timezone: z.string() }).strict();

export const weeklyOutcome = z
  .object({
    id: ulid,
    week,
    position: z.number().int().min(1).max(3),
    title: z.string(),
    project_id: ulid.nullable(),
    status: z.enum(["open", "met", "partly", "missed"]),
    archived_at: iso.nullable(),
  })
  .strict();

export const dayViewResponse = z
  .object({
    day,
    weekday: z.number().int().min(0).max(6),
    week,
    is_planning_day: z.boolean(),
    capacity: z
      .object({ available_min: z.number().int(), configured_min: z.number().int(), source: z.enum(["template", "override"]), day_type: dayType })
      .strict(),
    committed_at: iso.nullable(),
    closed_at: iso.nullable(),
    priorities: z.array(taskCard).max(3),
    tasks_by_workstream: z.array(z.object({ workstream: workstreamRef, planned_min: z.number().int(), tasks: z.array(taskCard) }).strict()),
    planned_min: z.number().int(),
    remaining_min: z.number().int(),
    unestimated_count: z.number().int(),
    load,
    projects: projectMap,
  })
  .strict();

export const weekViewResponse = z
  .object({
    week,
    previous_week: week,
    next_week: week,
    days: z
      .array(
        z
          .object({
            day,
            weekday: z.number().int().min(0).max(6),
            is_planning_day: z.boolean(),
            available_min: z.number().int(),
            source: z.enum(["template", "override"]),
            day_type: dayType,
            planned_min: z.number().int(),
            unestimated_count: z.number().int(),
            load,
            committed_at: iso.nullable(),
          })
          .strict(),
      )
      .length(7),
    workstreams: z.array(
      workstreamRef.extend({ weekly_target_min: z.number().int(), planned_min: z.number().int(), cells: z.record(day, z.array(taskCard)) }).strict(),
    ),
    backlog: z.array(taskCard).max(200),
    backlog_truncated: z.boolean(),
    outcomes: z.array(weeklyOutcome).max(3),
    projects: projectMap,
  })
  .strict();

export const quickAddResponse = z
  .object({
    input: z
      .object({
        title: z.string(),
        workstream_id: ulid.optional(),
        estimate_min: z.number().int().min(1).max(1440).optional(),
        planned_day: day.optional(),
        is_priority: z.literal(true).optional(),
        is_deliverable: z.literal(true).optional(),
        source: z.literal("quick_add"),
      })
      .strict(),
    workstream: z.object({ id: ulid, name: z.string(), colour: z.string() }).strict().nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

export const opResponse = z.object({ op: z.string(), result: z.unknown(), eventIds: z.array(ulid) }).strict();

export const errorResponse = z
  .object({ error: z.object({ code: z.string(), message: z.string(), details: z.unknown() }).strict() })
  .strict();

/** Fixture file name to the schema its contents must satisfy. */
export const FIXTURE_SCHEMAS = {
  "today.json": todayResponse,
  "day.json": dayViewResponse,
  "week.json": weekViewResponse,
  "quickadd-parse.json": quickAddResponse,
  "quickadd-parse-warnings.json": quickAddResponse,
  "op-task-create.json": opResponse,
  "op-day-commit.json": opResponse,
  "op-weekly-outcome-set.json": opResponse,
  "error-priority-cap.json": errorResponse,
  "error-duplicate.json": errorResponse,
  "op-undo-many.json": opResponse,
  "op-day-set-unchanged.json": opResponse,
} as const;
