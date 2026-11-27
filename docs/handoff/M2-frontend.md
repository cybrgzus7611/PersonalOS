# M2 handoff: frontend (OpenCode)

Status: the M2-API backend is merged into `main`. OpenCode (currently with DeepSeek V4.1 Flash) starts with the **design stage in section 5.0**, which has an approval gate before the dashboard is built.
Owner of this document: planning (Claude). Source of truth for product behaviour: [docs/SPEC.md](../SPEC.md) section 5 (screens) and the M2 row of section 8 (roadmap).

Read in this order: this file, [AGENTS.md](../../AGENTS.md), SPEC section 5.

---

## 1. What M1 delivered (verified on `m1-foundation`, PR #1, CI green)

| Area | Delivered | Where |
| --- | --- | --- |
| Schema | All spec tables, including `days`, `time_blocks`, `weekly_outcomes` (empty until later milestones), `documents` with versions, append-only `events`, FTS5 `search` | `migrations/0001_init.sql` |
| Operations | 50 validated operations (Zod), Tier A/B, one atomic batch each, one `events` row per change, undo by event id | `src/ops/` |
| REST API | 13 routes (section 3) | `src/api/app.ts` |
| Storage | D1 (Cloudflare) and node:sqlite adapters behind one interface | `src/db.ts`, `src/platform/` |
| Export | JSON (all tables) and CSV per table; restore into an empty database | `src/services/export.ts` |
| Seed | 5 workstreams with daily targets, Mon to Sat capacity (420 min placeholder, Sunday 0), 4 brain documents | `src/seed.ts` |
| Front end | **Placeholder only**: `public/index.html`, `public/css/app.css`, `public/js/main.js` show API health | `public/` |
| Tests | 35 shared tests run on node:sqlite and on local D1 in the Workers runtime (70 total) | `test/` |

Not delivered (by design): any UI beyond the placeholder, time blocks (M3), metrics and reviews (M3/M4), auth (milestone D), AI (M5).

## 2. Run the backend locally

```sh
npm install
cp .dev.vars.example .dev.vars        # PowerShell: Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                           # serves public/ and /api/* on http://localhost:8787
npm run seed:local                    # second terminal, once
npm run sample:local                  # optional, once: a realistic sample week through the real ops
```

`wrangler dev` serves `public/` as static assets with no build step, and any non-`/api` path falls back to `public/index.html` (single-page app). Edit a file in `public/` and reload the browser.

To start again from empty: stop the server, delete `.wrangler/state`, then migrate and seed again.

## 3. API contract (M1, stable)

All requests and responses are JSON. Same origin, so no CORS and no auth in local development (milestone D adds Cloudflare Access in front; the frontend needs no changes for it, but must handle a 401/403 by showing "Signed out, reload").

### 3.1 Envelopes

| Case | Status | Body |
| --- | --- | --- |
| Op success | 200 | `{ "op": "task.update", "result": { ...row }, "eventIds": ["01K..."] }` |
| List | 200 | `{ "items": [ ...rows ], "next_after": "01K..." \| null }` |
| Read one | 200 | `{ "item": { ...row }, "events"?: [...], "depends_on"?: [{ "depends_on_id": "..." }] }` |
| Error | 400 / 403 / 404 / 409 / 422 / 500 | `{ "error": { "code": "...", "message": "human readable", "details": null \| {...} } }` |

Error codes: `invalid_input` (400; `details.fieldErrors` maps field to messages), `forbidden` (403), `not_found` / `unknown_op` (404), `conflict` / `duplicate` (409; for `duplicate` on `task.create`, `details.task_id` is the existing task), `rule_violation` (422, e.g. a fourth priority on one day), `internal` (500).

Every `rule_violation` carries `details.rule`, a stable key to branch on: `max_priorities`, `priority_needs_day`, `backlog_has_no_day`, `task_done`, `day_closed`, `nothing_planned`, `blocks_submitted`, `outcome_scored`, `archived`, `archived_reference` (with `details.field`), `milestone_project_mismatch`, `self_parent`, `self_dependency`, `dependency_cycle`, `idea_promoted`, `not_undoable`.

**Unchanged saves are not errors.** `day.set`, `weekly_outcome.set` and `weekly_outcome.set_status` with the values already stored return `200` with `eventIds: []`. Show no toast (or "No change") and offer no Undo when `eventIds` is empty.

**Writes are same-site JSON only.** Every non-GET request must send `Content-Type: application/json` (otherwise `400`); a request with `Sec-Fetch-Site` other than `same-origin` or `none` gets `403`. `api.js` always sends the header, even with an empty `{}` body.

**Signed-out and platform responses (milestone D, handle now).** Behind Cloudflare Access an expired session may answer with a `302` redirect to an HTML login page, a `401` or `403`, or any non-JSON body. `api.js` must call `fetch` with `redirect: "manual"`, treat an `opaqueredirect`, a 401/403 without our envelope, or a non-JSON body as signed out ("Signed out, reload"), and treat `429`/`503` as "Service busy, try again" without retry loops.

The frontend shows `error.message` in a toast. It never parses the message text; it branches only on `error.code`.

### 3.2 Value conventions

- IDs: 26-character ULID strings. Treat as opaque.
- Booleans in rows are integers `0` / `1`. Send booleans in op inputs as JSON `true` / `false`.
- Days: `"YYYY-MM-DD"` (local calendar day in the user's time zone). Timestamps: UTC ISO-8601 strings.
- Absent values are `null`. In update ops, omit a field to leave it unchanged; send `null` to clear it.
- Weekdays: `0` = Monday ... `6` = Sunday. Week = ISO week, Monday start. Default planning days Monday to Saturday (`settings.planning_days`).

### 3.3 Read endpoints

| Method and path | Returns | Notes |
| --- | --- | --- |
| `GET /api/health` | `{ ok, migrations: [names] }` | |
| `GET /api/today` | `{ day, week, weekday, timezone }` | Use this, not the browser clock, for "today" and the top bar's ISO week. |
| `GET /api/settings` | `{ settings: { timezone, planning_days, day_close_time, "score.weights", "reward.tiers", ... } }` | Defaults filled in. |
| `GET /api/capacity` | `{ capacity: [{ weekday, available_min, start_time, end_time }] }` | Weekly template. |
| `GET /api/ops` | `{ ops: [{ name, tier, description, input (JSON Schema) }] }` | Authoritative op inputs. |
| `GET /api/entities/:type` | list envelope | `type`: workstream, objective, project, milestone, task, idea, decision, note, document, setting, capacity. Filters (exact match): `status`, `project_id`, `workstream_id`, `objective_id`, `milestone_id`, `planned_day`, `due_day`, `kind`, `day`. `include_archived=1`. Paging: `limit` (1 to 500, default 100) and `after=<next_after>`. Ordered by id (creation order). |
| `GET /api/entities/:type/:id` | read envelope | `?include=events` adds the entity's history. Tasks also return `depends_on`. |
| `GET /api/events` | `{ items }` newest first | Filters: `entity_type`, `entity_id`, `day`, `actor`, `op`; paging `before=<event id>`, `limit`. |
| `GET /api/search?q=` | `{ items: [{ entity_type, entity_id, day, snippet }] }` | `types=task,idea` filter, `limit` up to 50. Snippets mark matches with `[` `]`. |
| `GET /api/export.json`, `GET /api/export/<table>.csv` | file download | |

### 3.4 Write endpoint

`POST /api/ops/<name>` with the op input as the JSON body. This is the **only** way the frontend changes data.

Ops the M2 frontend uses:

| Op | Input (required in bold) | Used for |
| --- | --- | --- |
| `task.create` | **title**, **workstream_id**, project_id, milestone_id, status (`todo`\|`backlog`), estimate_min, planned_day, due_day, is_deliverable, is_priority, notes, allow_duplicate | Quick add, double-click an empty swimlane cell |
| `task.update` | **id**, then any of: title, notes, workstream_id, project_id, milestone_id, status (`todo`\|`in_progress`\|`backlog`\|`dropped`), estimate_min, planned_day, due_day, is_deliverable, is_priority | Drag to another day or lane (`planned_day`, `workstream_id`), drop on Backlog (`planned_day: null`), toggle priority, edit |
| `task.complete` / `task.reopen` | **id** | Checkbox |
| `task.archive` | **id** | Remove from plan (archived, not deleted) |
| `event.undo` | **event_id**, or **event_ids** (array) | Undo toast: send the op response's whole `eventIds` as `event_ids`; all are undone in one write, or none (`409` if any changed since) |
| `capacity.set` | **weekday**, **available_min**, start_time, end_time | Settings panel (template) |
| `setting.set` | **key**, **value** | Settings panel: `timezone`, `planning_days` |

Business rules the server enforces (the UI reflects them, never re-implements them):

- At most **3 priorities per day**: a fourth returns `422 rule_violation`. Show the message and leave the toggle off.
- **Duplicate task** titles in the same project: `409 duplicate` with `details.task_id`. Offer "Open existing" or "Create anyway" (resend with `allow_duplicate: true`).
- Moving a task to a later day or off the plan increments `postpone_count`. The UI shows a `↻N` badge when `postpone_count >= 2`.
- A done task must be reopened before other edits (`422`).
- **Backlog and days.** Dropping a task with status `backlog` on a day makes it `todo` automatically (it then counts in load and Commit). Dropping a task on the Backlog tray sends `planned_day: null` and keeps its status (`todo` stays `todo`); `status: "backlog"` also clears the day. A task cannot be `backlog` and have a day (`422 backlog_has_no_day`).
- **Priorities belong to a day.** `is_priority: true` needs a `planned_day` (`422 priority_needs_day`). Taking a task off the plan (`planned_day: null`) turns its priority off.
- `event.undo` returns `409 conflict` if the record changed after the change being undone. Say "Can't undo: changed since".

## 4. M2-API contract (built by Claude Code on `be/m2-api`)

> **Approved by Nisa on 27 Nov 2026** as gaps G1 to G6. Claude Code built them on `be/m2-api`. Code against this section once that PR is merged; until then use the fixtures in `test/fixtures/api/` (real responses from a synthetic week, 2026-W49; regenerate with `npm run fixtures:api`). The shapes are also defined as Zod schemas in `src/api/contract.ts`, and CI checks both the live endpoints and the fixtures against them.

### 4.1 New ops (`POST /api/ops/<name>`)

| Op | Tier | Input (required in bold) | Rules |
| --- | --- | --- | --- |
| `day.set` | A | **day**, available_min (0 to 1440), day_type (`work`\|`leave`\|`sick`\|`light`); at least one of the two | Creates the day's override row from the weekly template if none exists. A `light` day needs `available_min` (`400`). `422` if the day is closed; unchanged values return no events. |
| `day.commit` | A | **day** | Freezes `plan_snapshot` (available minutes, day type, the planned todo and in-progress tasks, the priority ids). `409` if already committed, `422` if nothing is planned or the day is closed. |
| `day.uncommit` | B | **day** | `409` if not committed, `422` once any time block of that day has been submitted (M3). |
| `weekly_outcome.set` | B | **week** (`2026-W48`), **position** (1 to 3), **title**, project_id (or `null`) | Creates the slot or replaces the title and project of the active outcome in that slot. |
| `weekly_outcome.set_status` | A | **id**, **status** (`open`\|`met`\|`partly`\|`missed`) | Unchanged status returns no events. |
| `weekly_outcome.clear` | B | **id** | Archives an `open` outcome so the slot is free again (nothing is deleted). `422` for an outcome that already has a result. |

Undo works on all of them through `event.undo`. Undoing a `day.set` that created the override row returns the day to its template.

### 4.2 Load rule (used by both views)

- `planned_min`: sum of `estimate_min` over the day's planned tasks with status `todo`, `in_progress` or `done` (dropped, backlog and archived tasks are left out). A task without an estimate counts **30 minutes** and is counted in `unestimated_count`.
- `remaining_min` (day view): the same sum over `todo` and `in_progress` only.
- Leave and sick days have `available_min = 0`, whatever the template or override says (`configured_min` keeps the configured figure).
- `load`: `off` on leave and sick days (show the day muted, and if it still holds tasks, a "Move N tasks" prompt; never red); otherwise `over` when `planned_min > available_min` (so a 0-minute work day with any work is over), `high` when `planned_min > 0.9 × available_min`, else `ok`. Colours: `high` amber, `over` red.
- A workstream's `weekly_target_min` = `daily_target_min` × the week's planning days (`settings.planning_days`, default Monday to Saturday) that are not leave or sick.
- Show `unestimated_count` next to the capacity figure (for example "+2 unestimated"), so the total makes sense.
- Both views include `projects`: a map from project id to `{ id, slug, title, status, workstream_id, archived_at }` for every project their cards and outcomes reference (archived ones included), so project tags need no extra request.

Task objects in both views have: `id, title, workstream_id, project_id, milestone_id, status, estimate_min, planned_day, due_day, is_priority, is_deliverable, postpone_count, done_at, created_at`. Within a day they are ordered priority first, then creation order. Workstream objects have: `id, name, colour, daily_target_min, is_core, sort_order, archived_at` (archived workstreams appear only while they still have tasks in view).

### 4.3 `GET /api/day/:day`

```json
{
  "day": "2026-12-01", "weekday": 1, "week": "2026-W49", "is_planning_day": true,
  "capacity": { "available_min": 420, "configured_min": 420, "source": "template", "day_type": "work" },
  "committed_at": null, "closed_at": null,
  "priorities": [task],
  "tasks_by_workstream": [{ "workstream": workstream, "planned_min": 75, "tasks": [task] }],
  "planned_min": 75, "remaining_min": 75, "unestimated_count": 1, "load": "ok",
  "projects": { "01K...": { "id": "01K...", "slug": "template-shop-launch", "title": "Template shop launch", "status": "active", "workstream_id": "01K...", "archived_at": null } }
}
```

`source` is `override` when the day's minutes differ from the weekly template or its type is not `work` (set with `day.set`); otherwise `template`. Every active workstream is listed, even with no tasks. `400 invalid_input` for a date that does not exist.

### 4.4 `GET /api/week/:isoWeek`

```json
{
  "week": "2026-W49", "previous_week": "2026-W48", "next_week": "2026-W50",
  "days": [{ "day": "2026-11-30", "weekday": 0, "is_planning_day": true, "available_min": 420, "source": "template",
             "day_type": "work", "planned_min": 90, "unestimated_count": 0, "load": "ok", "committed_at": null }],
  "workstreams": [{ ...workstream, "weekly_target_min": 360, "planned_min": 90, "cells": { "2026-11-30": [task], "...": [] } }],
  "backlog": [task], "backlog_truncated": false,
  "outcomes": [{ "id": "...", "week": "2026-W49", "position": 1, "title": "...", "project_id": null, "status": "open", "archived_at": null }],
  "projects": { "01K...": { "id": "01K...", "slug": "...", "title": "...", "status": "active", "workstream_id": "01K...", "archived_at": null } }
}
```

`days` always has seven entries, Monday first; `cells` always has all seven day keys. `backlog` is open tasks (`todo`, `in_progress`, `backlog`) with no planned day: priorities first, then by due day, at most 200 (`backlog_truncated` says if more exist). `400 invalid_input` for a week that does not exist (e.g. `2026-W53`).

### 4.5 `POST /api/quickadd/parse`

Body `{ "text": "prod: SOP template 45m tue !", "today"?: "2026-11-27" }` (`today` defaults to `/api/today`; at most 500 characters). Nothing is saved. Returns:

```json
{
  "input": { "title": "SOP template", "workstream_id": "01K...", "estimate_min": 45, "planned_day": "2026-12-01", "is_priority": true, "source": "quick_add" },
  "workstream": { "id": "01K...", "name": "Production and creative practice", "colour": "#a26bff" },
  "warnings": []
}
```

Syntax: an optional `alias: ` first (a colon **followed by a space**, so "14:30" is never an alias), then the title, then modifiers read **from the end only**, each a separate word (so a title may contain "tue", and "Launch!" keeps its "!"). An alias matches, in this order: the workstream's full name or initials (`bd`); the start of its first word (`prod`, `a` for AI, `c` for Client); or, with 3+ letters, the start of a later word other than and/of/the (`admin`). Several matches give a warning and no `workstream_id`; no match leaves the text in the title ("Meeting: Q4 review") with a warning. Estimates `45m`, `45min`, `2h`, `1.5h`, `1h30m`; days `today`, `tomorrow`/`tmr`, `mon` to `sun` or full names (next occurrence, today included), `YYYY-MM-DD`; `!` priority; `*` deliverable. `!` without a day is dropped with a warning (a priority belongs to a day). Warnings (never errors): no or ambiguous workstream, no title, day in the past, no estimate, priority without a day. The UI shows each parsed field as a removable chip (removing an estimate or day chip puts that word back into the title), shows the warnings, then sends `input` to `task.create`.

### 4.6 Not in M2

G7 (manual ordering inside a cell) is deferred: cards sort by priority, then creation.

## 5. Frontend specification (M2 scope)

From SPEC section 5. Only what M2 needs; Projects and Review views show a "Coming in M4" placeholder.

M2 frontend work runs in three stages, each ending in a PR and Nisa's approval: **(1)** the design playground (5.0), **(2)** the design system (5.0b), **(3)** the dashboard (5.1 to 5.6), styled only through the design system.

### 5.0 Stage 1: visual design exploration and curation (approval gate)

> **Added by Nisa on 27 Nov 2026.** Build this stage first. Sections 5.1 to 5.6 (the real dashboard) do not start until Nisa has reviewed the playground and approved a direction in writing. Until then, `public/index.html` stays the M1 placeholder.

**What to build:** a standalone **UI Design Playground** at `public/playground/index.html`, served by `wrangler dev` at http://localhost:8787/playground/. It is a design tool, not the app. Nothing in `public/js/` loads it.

**Four materially different directions.** Each one differs in palette, type, density, surfaces and layout, not only colour:

| # | Direction | Intent |
| --- | --- | --- |
| A | Premium dark command centre | Near-black blue-grey, one accent, thin workstream borders, calm and dense (the current SPEC 5 style) |
| B | Modern light workspace | Light neutral surfaces, soft elevation, generous spacing, friendly type |
| C | Editorial / information-dense | Paper-like, strong typographic hierarchy, rules instead of boxes, tables and small multiples |
| D | Glass / futuristic workspace | Layered translucent panels, subtle blur, luminous accents (keep text contrast at WCAG AA) |

**Every direction shows the same six screens**, built from real Personal OS content:

1. Daily command centre (priorities, today's tasks by workstream, capacity bar, Commit state)
2. Weekly project swimlane (lanes, day headers with load, cards, backlog tray, outcomes strip)
3. Project register (projects with status, priority, due day, last activity, open-task count)
4. Time-block accountability interface (the day timeline, the active block, the submit sheet with its statuses)
5. Progress and performance visualisations (execution, adherence and focus, the composite score with its three parts, weekly output against target, workstream minutes against target)
6. Navigation and settings (top bar, view switcher, quick-add, settings panel)

**Data: the real API, never a mock backend.**
- Screens 1, 2, 3 and 6 read the live endpoints through `public/js/api.js` (GET only: `/api/today`, `/api/day/:day`, `/api/week/:isoWeek`, `/api/entities/project`, `/api/entities/workstream`, `/api/settings`, `/api/capacity`). The playground never writes.
- To get realistic content, run `npm run sample:local` once after seeding. It loads a sample week (5 projects, 18 tasks, 3 outcomes, an overloaded Tuesday, a light Saturday, a committed Monday) **through the real ops**, so it is the same data the app will show.
- Screens 4 and 5 depend on M3 and M4 features that have no endpoints yet. For those only, use one static file, `public/playground/future-sample.js`, shaped exactly like SPEC 7 (blocks with `sched_start`, `sched_end`, status; submissions; daily and weekly metric values). Label those panels "Illustrative: arrives in M3/M4" on screen. Do not add server code, and do not reuse this file in the app.

**Curation: compare, mix and give feedback.**
- A fixed picker bar to switch direction (A to D) and screen, plus a side-by-side mode that shows the same screen in two directions.
- **Mix and match by token group**, so Nisa can combine elements: palette, typography, density and spacing, surface style (cards, borders, shadows, radii), controls (buttons, inputs), navigation style and chart style can each come from a different direction. Implement each group as a set of CSS custom properties switched by a `data-*` attribute on `<html>` (for example `data-palette="b" data-type="c" data-surface="a"`).
- A notes box per direction and screen. Notes and the current mix are kept in `localStorage`. A **Copy feedback** button copies a short Markdown summary (the chosen mix and all notes) for Nisa to paste into the project chat.
- Light and dark variants where a direction supports both.

**Stop here.** Open a PR titled `M2 design playground` with screenshots of each direction's six screens, then wait. Nisa replies with the chosen mix and changes.

### 5.0b Stage 2: the design system (after approval, before the dashboard)

Turn the approved mix into a reusable design system that is **separate from application logic**, so the look can change without touching functionality:

- **Tokens** as CSS custom properties: colour (semantic names such as `--color-surface`, `--color-text-muted`, `--color-load-high`, plus workstream colours), typography (families, sizes, weights, line heights, tabular numbers), spacing and layout (a spacing scale, grid gutters, lane and column widths), radii, borders, shadows and elevation, motion (durations, easing), z-index.
- **Themes** as token overrides under `[data-theme="..."]`, so another approved direction can be switched in later.
- **Components** styled only through tokens: cards and panels, buttons, inputs, selects and toggles, chips, toasts, navigation and the top bar, the capacity bar, progress rings or bars, the chart primitives for metrics, empty states.
- **Responsive behaviour**: desktop first from 1280 px wide, a usable layout down to 900 px, and below that lanes scroll horizontally. A phone layout is not required before deployment (decided 27 Nov 2026).
- **Structure**: the app keeps one stylesheet, `public/css/app.css` (CLAUDE.md), ordered as tokens, then themes, then base, then components, then views. JS never sets colours, sizes or other styles inline; it sets classes and `data-*` states only.
- A **style guide page** at `public/playground/system.html` renders every token and component from `app.css` itself, so it cannot drift.

Open a PR titled `M2 design system`, and wait for Nisa's approval. Then build sections 5.1 to 5.6 on top of it.

### 5.1 Shell

- Single page, hash routes: `#/today` (default), `#/week`, `#/week/2026-W48`, `#/projects`, `#/review`.
- **Top bar** (always visible): date and ISO week from `/api/today`; a Next card placeholder reading "Time blocks arrive in M3"; quick-add field (focus with `/` or Ctrl+K); a small connection dot (API health).
- **Chat rail**: not in M2. Leave a collapsed 0-width slot in the layout grid so M5 can add it without restructuring.
- **Toasts**: every successful write shows "Saved" with **Undo** for 10 seconds (none when `eventIds` is empty); errors show `error.message` and stay until dismissed or the next action.
- **After every write**, update optimistically, then re-fetch the current view (`/api/day/:day` or `/api/week/:isoWeek`) so server-computed load, `postpone_count` and ordering stay authoritative.

### 5.2 Today view

| Region | Contents | Data |
| --- | --- | --- |
| Header strip | Up to 3 priority tasks with checkboxes; plan state chip: Draft, Committed (with time) | G4 `priorities`, `committed_at` |
| Main left (60%) | Placeholder panel "Time-block timeline (M3)" | none |
| Main right (40%) | Tasks for today grouped by workstream (lane colour as a 3 px left border), checkbox, estimate, project tag, star toggle for priority, `↻N` badge; capacity bar `planned / available` coloured by `load` | G4 |
| Day settings | A small control beside the capacity bar: day type (work, light, leave, sick) and available minutes for this day only; "Reset to template" undoes the override | `day.set`, `event.undo` |
| Footer | **Commit plan**; once committed it shows the time and an **Uncommit** link (refused with `422 blocks_submitted` from M3) | `day.commit`, `day.uncommit` |

### 5.3 Week view (the swimlane, primary planning screen)

| Element | Behaviour | Data / op |
| --- | --- | --- |
| Header row | Mon to Sun with date; Sunday column narrow unless it holds tasks; each header shows `planned / available` and turns amber (`high`) or red (`over`); leave and sick days (`off`) are muted. Clicking a header opens the same day-settings control as Today. | G5 `days`, `day.set` |
| Outcomes strip | 3 slots above the grid; click to edit title, cycle status open/met/partly/missed | G5 `outcomes`, G3 ops |
| Lanes | One row per workstream in `sort_order`; core workstreams marked with a small dot; lane footer `planned vs weekly target` | G5 `workstreams` |
| Cards | Title (2 lines max), estimate, project tag, done tick, `↻N` badge, priority star | tasks |
| Drag and drop | Native HTML5 drag. Drop on a cell: `task.update { planned_day, workstream_id }` (a backlog task becomes todo on the server). Drop on Backlog tray: `planned_day: null`. Optimistic move, rolled back on error, then re-fetch the week. | `task.update` |
| Add | Double-click an empty cell: inline title field; Enter creates with that day and lane | `task.create` |
| Backlog tray | Collapsible column on the right with unscheduled open tasks | G5 `backlog` |
| Navigation | Previous / next week, "This week" | route |
| Keyboard | Arrow keys move focus between cards; Space toggles done; `[` / `]` move the focused card a day earlier/later | same ops |

### 5.3a Project picker (minimal, approved 27 Nov 2026)

- On a task's edit popover and in the quick-add confirm row: a **Project** select listing active projects (`GET /api/entities/project?status=active`), plus "None" and "New project…".
- **New project…** opens a small inline form: title (required) and workstream (defaults to the task's lane). It calls `project.create { title, workstream_id }`, then sets the task's `project_id` with `task.update`. Send no slug: the server derives a unique one from the title.
- Weekly outcome slots use the same select for their optional project.
- No project list, drawer, status or priority editing in M2; that is the M4 Projects register.

### 5.4 Settings panel (gear icon in top bar)

Time zone (select of IANA zones or free text, validated by the server), planning days, the 7-day capacity template. Uses `setting.set` and `capacity.set`. Workstream editing is out of scope for M2.

### 5.5 Visual style

**The approved design system (5.0b) decides the look.** The defaults below are direction A and apply only where the approved system says nothing. Near-black blue-grey background, one accent colour, workstream colours only as thin borders and tags, system UI font, tabular numbers, no gradients or badges beyond `↻N`, 150 ms transitions. Usable from 1280 px wide; below 900 px lanes scroll horizontally. Visible focus outlines; every control reachable by keyboard; colour is never the only signal (load also shows a word or icon).

### 5.6 Front-end code structure (no build step, no npm packages in the browser)

```text
public/
  index.html              app shell markup only
  css/app.css             the one stylesheet: tokens, themes, base, components, views (5.0b)
  playground/             design stage only, never loaded by the app: index.html, playground.css,
                          playground.js, future-sample.js, system.html
  js/
    main.js               boot, hash router, top bar
    api.js                the ONLY module that calls fetch(); one function per endpoint and op
    store.js              in-memory state + tiny pub/sub; no global mutable state elsewhere
    toast.js              toasts and the Undo flow
    dnd.js                drag-and-drop helpers
    quickadd.js           quick-add field (calls the parse endpoint, then task.create)
    views/today.js
    views/week.js
    views/settings.js
    views/placeholder.js
    components/taskCard.js  components/capacityBar.js  components/outcomes.js
    lib/                  pure helpers with no DOM or fetch (date maths, load labels, quick-add chips),
                          unit-tested in test/frontend/*.test.ts (already included in the Vitest node project)
```

Rules: ES modules with relative imports and `.js` extensions; no inline `<script>` or inline event handlers (the CSP in milestone D forbids them); escape all user text (set `textContent`, never `innerHTML` with data); no external fonts, CDNs or analytics; dates handled as `YYYY-MM-DD` strings, never through `new Date(day)` (time-zone bugs). `npm run check` enforces part of this with `scripts/check-public.mjs`: no `fetch(` outside `js/api.js`, no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, no other-origin URLs, no inline handlers or inline scripts.

## 6. Testing and integration

| Step | Who | What |
| --- | --- | --- |
| Contract | Claude Code | The M2-API PR adds `test/shared/contract.suite.ts`, which calls each endpoint in section 3 and 4 and checks the response shape, and writes the fixtures in `test/fixtures/api/`. Runs on both adapters in CI. |
| Frontend unit | OpenCode | Pure helpers (date maths, load formatting, quick-add display) go in `public/js/lib/` and get tests in `test/frontend/*.test.ts`, run by the existing Vitest node project (no new dependency). |
| Design review | Nisa | Playground PR: compare the four directions and the mix; reply with the choice and notes (Copy feedback). Design system PR: approve the tokens and style guide. |
| Manual checklist | OpenCode, then Nisa | `docs/handoff/M2-checklist.md` (OpenCode writes it from section 5): plan a real week in under 10 minutes, drag across days and lanes, overload turns red, 4th priority refused, duplicate prompt, undo, commit, reload keeps everything. |
| Integration review | Claude Code (step 6 of the workflow) | Reviews the frontend PR against this contract: only `api.js` calls fetch, no writes outside `/api/ops`, no files outside `public/` and `test/frontend/` changed, CI green, checklist passes on `wrangler dev`. |
| Browser automation | Later | Playwright only if regressions appear (a dependency, needs approval). |

## 7. Order of work

1. Nisa approves section 4 (done, 27 Nov 2026).
2. Claude Code: branch `be/m2-api`, builds G1 to G6 with tests and fixtures, PR, merge.
3. OpenCode (DeepSeek V4.1 Flash): branch `fe/m2-dashboard` from `main`.
   a. Design playground (5.0), PR `M2 design playground`. **Stop for Nisa's choice of direction and mix.**
   b. Design system (5.0b), PR `M2 design system`. **Stop for Nisa's approval.**
   c. Dashboard (5.1 to 5.6), PR `M2 frontend: Today and Week views`.
4. Optional: a second model in OpenCode (for example GLM) reviews or debugs on its own `fe/m2-dashboard-<model>` branch (PR into `fe/m2-dashboard`), never on `be/`.
5. Claude Code: integration review of each PR; Nisa runs the checklist and merges.
