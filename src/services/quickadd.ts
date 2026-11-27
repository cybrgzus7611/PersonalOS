/**
 * Quick-add parser: turns one line into a task.create input without saving anything.
 *
 *   prod: SOP template 45m tue !
 *   └─┬─┘ └────┬─────┘ └┬┘ └┬┘ └ priority
 *  workstream  title  estimate day
 *
 * - "alias:" at the start picks a workstream. An alias matches a workstream when it equals the
 *   name's initials (bd = Business development) or starts the name or one of its words
 *   (prod = Production and creative practice). Only active workstreams are matched.
 * - Modifiers are read from the END of the line only, so a title can still contain words like "tue".
 *   Estimates: 45m, 45min, 2h, 1h30m, 1.5h. Days: today, tomorrow (tmr), mon to sun (next occurrence,
 *   today included), or YYYY-MM-DD. Priority: "!". Deliverable: "*".
 * - Problems never throw; they come back as warnings, and fields that could not be resolved are left out.
 */
import type { Db } from "../db.ts";
import { addDays, isRealDay, weekdayOf } from "./calendar.ts";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const FULL_WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MAX_ESTIMATE_MIN = 24 * 60;

export interface QuickAddResult {
  input: {
    title: string;
    workstream_id?: string;
    estimate_min?: number;
    planned_day?: string;
    is_priority?: true;
    is_deliverable?: true;
    source: "quick_add";
  };
  workstream: { id: string; name: string; colour: string } | null;
  warnings: string[];
}

export function parseEstimate(token: string): number | null {
  const t = token.toLowerCase();
  let m = /^(\d{1,4})(m|min|mins)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d{1,2}(?:\.\d{1,2})?)h$/.exec(t);
  if (m) return Math.round(Number(m[1]) * 60);
  m = /^(\d{1,2})h(\d{1,2})m?$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

export function parseDay(token: string, today: string): string | null {
  const t = token.toLowerCase();
  if (t === "today" || t === "tod") return today;
  if (t === "tomorrow" || t === "tmr" || t === "tom") return addDays(today, 1);
  const short = WEEKDAYS.indexOf(t);
  const wd = short >= 0 ? short : FULL_WEEKDAYS.indexOf(t);
  if (wd >= 0) return addDays(today, (wd - weekdayOf(today) + 7) % 7);
  if (isRealDay(t)) return t;
  return null;
}

function initials(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !["and", "of", "the", "&"].includes(w))
    .map((w) => w[0])
    .join("");
}

export function matchWorkstream<W extends { name: string }>(alias: string, workstreams: W[]): W[] {
  const a = alias.toLowerCase();
  const exact = workstreams.filter((w) => w.name.toLowerCase() === a || initials(w.name) === a);
  if (exact.length) return exact;
  return workstreams.filter((w) => {
    const name = w.name.toLowerCase();
    return name.startsWith(a) || name.split(/[^a-z0-9]+/).some((word) => word.startsWith(a));
  });
}

export async function parseQuickAdd(db: Db, text: string, today: string): Promise<QuickAddResult> {
  const warnings: string[] = [];
  let rest = text.trim().replace(/\s+/g, " ");
  const input: QuickAddResult["input"] = { title: "", source: "quick_add" };
  let workstream: QuickAddResult["workstream"] = null;

  const aliasMatch = /^([A-Za-z][\w-]{0,30}):\s*/.exec(rest);
  if (aliasMatch) {
    rest = rest.slice(aliasMatch[0].length);
    const active = await db.all<{ id: string; name: string; colour: string }>(
      "SELECT id, name, colour FROM workstreams WHERE archived_at IS NULL ORDER BY sort_order, name",
    );
    const hits = matchWorkstream(aliasMatch[1], active);
    if (hits.length === 1) {
      workstream = hits[0];
      input.workstream_id = hits[0].id;
    } else if (hits.length === 0) {
      warnings.push(`no workstream matches "${aliasMatch[1]}"`);
    } else {
      warnings.push(`"${aliasMatch[1]}" matches several workstreams: ${hits.map((h) => h.name).join(", ")}`);
    }
  } else {
    warnings.push("no workstream given; start with an alias such as prod:");
  }

  const tokens = rest.split(" ").filter(Boolean);
  while (tokens.length > 1) {
    const token = tokens[tokens.length - 1];
    if (token === "!" && !input.is_priority) {
      input.is_priority = true;
    } else if (token === "*" && !input.is_deliverable) {
      input.is_deliverable = true;
    } else if (input.estimate_min === undefined && parseEstimate(token) !== null) {
      const est = parseEstimate(token)!;
      if (est <= 0 || est > MAX_ESTIMATE_MIN) {
        warnings.push(`estimate ${token} ignored: must be between 1 minute and 24 hours`);
      } else {
        input.estimate_min = est;
      }
    } else if (input.planned_day === undefined && parseDay(token, today) !== null) {
      input.planned_day = parseDay(token, today)!;
    } else {
      break;
    }
    tokens.pop();
  }

  input.title = tokens.join(" ").trim();
  if (!input.title) warnings.push("the task needs a title");
  if (input.planned_day && input.planned_day < today) warnings.push(`${input.planned_day} is in the past`);
  if (input.estimate_min === undefined) warnings.push(`no estimate; it will count as 30 minutes in the plan`);
  return { input, workstream, warnings };
}
