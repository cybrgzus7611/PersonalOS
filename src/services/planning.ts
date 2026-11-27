/**
 * Read models for the Today and Week views (M2). Pure reads: nothing here writes.
 *
 * Load rule (docs/handoff/M2-frontend.md section 4):
 * - planned_min is the sum of estimate_min over the day's planned tasks that are todo, in_progress or done.
 *   A task without an estimate counts DEFAULT_ESTIMATE_MIN and is counted in unestimated_count.
 * - remaining_min is the same sum over todo and in_progress only.
 * - Leave and sick days have 0 available minutes, whatever the template says.
 * - load is "over" when planned_min > available_min (so a 0-minute day with any work is over),
 *   "high" when planned_min > 90% of available_min, otherwise "ok".
 */
import type { Db, Row } from "../db.ts";
import { OpError } from "../errors.ts";
import { addDays, daysOfIsoWeek, isRealDay, isoWeekOf, weekdayOf } from "./calendar.ts";
import { readSetting } from "./settings.ts";

export const DEFAULT_ESTIMATE_MIN = 30;
export const HIGH_LOAD_RATIO = 0.9;
export const BACKLOG_LIMIT = 200;

export type Load = "ok" | "high" | "over";

const TASK_COLS =
  "id, title, workstream_id, project_id, milestone_id, status, estimate_min, planned_day, due_day, is_priority, is_deliverable, postpone_count, done_at, created_at";
const WS_COLS = "id, name, colour, daily_target_min, is_core, sort_order, archived_at";
const PLANNED_STATUSES = "('todo','in_progress','done')";

export function loadOf(plannedMin: number, availableMin: number): Load {
  if (plannedMin > availableMin) return "over";
  if (plannedMin > availableMin * HIGH_LOAD_RATIO) return "high";
  return "ok";
}

function minutes(tasks: Row[], open = false) {
  let total = 0;
  let unestimated = 0;
  for (const t of tasks) {
    if (open && t.status === "done") continue;
    if (t.estimate_min == null) unestimated += 1;
    total += (t.estimate_min as number | null) ?? DEFAULT_ESTIMATE_MIN;
  }
  return { total, unestimated };
}

async function capacityFor(db: Db, days: string[]) {
  const template = new Map(
    (await db.all<{ weekday: number; available_min: number }>("SELECT weekday, available_min FROM capacity_template")).map((r) => [r.weekday, r.available_min]),
  );
  const marks = days.map(() => "?").join(", ");
  const overrides = new Map((await db.all<Row>(`SELECT * FROM days WHERE day IN (${marks})`, days)).map((r) => [r.day as string, r]));
  return (day: string) => {
    const row = overrides.get(day);
    const dayType = (row?.day_type as string) ?? "work";
    const fromTemplate = template.get(weekdayOf(day)) ?? 0;
    const configured = row ? (row.available_min as number) : fromTemplate;
    // A day row also exists once a day is committed; it only counts as an override when it differs.
    const overridden = !!row && (configured !== fromTemplate || dayType !== "work");
    return {
      available_min: dayType === "leave" || dayType === "sick" ? 0 : configured,
      configured_min: configured,
      source: overridden ? ("override" as const) : ("template" as const),
      day_type: dayType,
      committed_at: (row?.committed_at as string) ?? null,
      closed_at: (row?.closed_at as string) ?? null,
    };
  };
}

async function plannedTasks(db: Db, from: string, to: string): Promise<Row[]> {
  return db.all<Row>(
    `SELECT ${TASK_COLS} FROM tasks
      WHERE planned_day BETWEEN ? AND ? AND archived_at IS NULL AND status IN ${PLANNED_STATUSES}
      ORDER BY planned_day, is_priority DESC, id`,
    [from, to],
  );
}

/** Active workstreams, plus archived ones that still have tasks in view. */
async function workstreamsFor(db: Db, tasks: Row[]): Promise<Row[]> {
  const rows = await db.all<Row>(`SELECT ${WS_COLS} FROM workstreams ORDER BY sort_order, name`);
  const used = new Set(tasks.map((t) => t.workstream_id));
  return rows.filter((w) => !w.archived_at || used.has(w.id));
}

function requireDay(day: string) {
  if (!isRealDay(day)) throw new OpError("invalid_input", "day must be a real date, YYYY-MM-DD");
}

export async function dayView(db: Db, day: string) {
  requireDay(day);
  const cap = (await capacityFor(db, [day]))(day);
  const tasks = await plannedTasks(db, day, day);
  const workstreams = await workstreamsFor(db, tasks);
  const planned = minutes(tasks);
  const remaining = minutes(tasks, true);
  const planningDays = (await readSetting(db, "planning_days")) as readonly number[];
  return {
    day,
    weekday: weekdayOf(day),
    week: isoWeekOf(day),
    is_planning_day: planningDays.includes(weekdayOf(day)),
    capacity: { available_min: cap.available_min, configured_min: cap.configured_min, source: cap.source, day_type: cap.day_type },
    committed_at: cap.committed_at,
    closed_at: cap.closed_at,
    priorities: tasks.filter((t) => t.is_priority),
    tasks_by_workstream: workstreams.map((w) => {
      const own = tasks.filter((t) => t.workstream_id === w.id);
      return { workstream: w, planned_min: minutes(own).total, tasks: own };
    }),
    planned_min: planned.total,
    remaining_min: remaining.total,
    unestimated_count: planned.unestimated,
    load: loadOf(planned.total, cap.available_min),
  };
}

export async function weekView(db: Db, week: string) {
  const days = daysOfIsoWeek(week);
  if (!days) throw new OpError("invalid_input", "week must be an ISO week such as 2026-W48");
  const capOf = await capacityFor(db, days);
  const tasks = await plannedTasks(db, days[0], days[6]);
  const workstreams = await workstreamsFor(db, tasks);
  const planningDays = (await readSetting(db, "planning_days")) as readonly number[];

  const dayRows = days.map((day) => {
    const cap = capOf(day);
    const own = tasks.filter((t) => t.planned_day === day);
    const planned = minutes(own);
    return {
      day,
      weekday: weekdayOf(day),
      is_planning_day: planningDays.includes(weekdayOf(day)),
      available_min: cap.available_min,
      source: cap.source,
      day_type: cap.day_type,
      planned_min: planned.total,
      unestimated_count: planned.unestimated,
      load: loadOf(planned.total, cap.available_min),
      committed_at: cap.committed_at,
    };
  });

  const lanes = workstreams.map((w): Row & { weekly_target_min: number; planned_min: number; cells: Record<string, Row[]> } => {
    const own = tasks.filter((t) => t.workstream_id === w.id);
    const cells: Record<string, Row[]> = {};
    for (const day of days) cells[day] = own.filter((t) => t.planned_day === day);
    return {
      ...w,
      weekly_target_min: (w.daily_target_min as number) * planningDays.length,
      planned_min: minutes(own).total,
      cells,
    };
  });

  const backlog = await db.all<Row>(
    `SELECT ${TASK_COLS} FROM tasks
      WHERE planned_day IS NULL AND archived_at IS NULL AND status IN ('todo','in_progress','backlog')
      ORDER BY is_priority DESC, due_day IS NULL, due_day, id LIMIT ?`,
    [BACKLOG_LIMIT + 1],
  );
  const outcomes = await db.all<Row>("SELECT * FROM weekly_outcomes WHERE week = ? AND archived_at IS NULL ORDER BY position", [week]);

  return {
    week,
    previous_week: isoWeekOf(addDays(days[0], -7)),
    next_week: isoWeekOf(addDays(days[0], 7)),
    days: dayRows,
    workstreams: lanes,
    backlog: backlog.slice(0, BACKLOG_LIMIT),
    backlog_truncated: backlog.length > BACKLOG_LIMIT,
    outcomes,
  };
}
