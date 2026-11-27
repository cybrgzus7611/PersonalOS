# Personal OS: Architecture & Product Spec

Nov 27, 2026 · Nisa

> Snapshot of the living spec (Claude Doc: https://claude.ai/artifact/3fqAiTh2ypdCNkZ65ptvEn). Update this file when the living spec changes; the code follows this file.

## Summary and critical review

Build it as a small TypeScript app on one Cloudflare Worker over D1 (hosted SQLite), developed locally first and deployed to the free tier, with a no-build vanilla JS front end and the AI behind a strict list of typed operations. Ship the accountability loop (plan, time-block, submit, score) before any AI, and keep Markdown as a readable output rather than a second database. The vision holds up. The gaps below are the things most likely to make the system fail in daily use, ordered by risk.

### What is missing from the spec

1. **Capacity has no source.** Rule 1 (protect capacity) needs to know how many hours you actually have each day. Add a weekly capacity template (working hours per weekday) plus per-day overrides for client days, appointments and days off.
2. **No "committed plan" moment.** Schedule adherence compares against "the schedule I originally committed to", but nothing defines when a plan becomes committed. Add an explicit Commit step in the morning briefing that freezes a snapshot. Changes after that are reschedules, which is what makes adherence measurable.
3. **Unsubmitted blocks.** The status list has no answer for a block you simply never submitted. Add a `missed` status, set automatically at day close, so forgotten blocks count against adherence instead of disappearing.
4. **Days off and sick days.** A day marked as leave must be excluded from scores. Otherwise Rule 10 (do not punish legitimate changes) breaks on day one.
5. **Day and week boundaries.** Define the week as Monday to Sunday, the day by local date, and a configurable day-close time (for example 04:00) so working past midnight still lands on the right day.
6. **Capture away from the desk.** Ideas arrive on your phone. A localhost-only app cannot receive them. MVP: none. Later: reach the app over your home network or a private tunnel such as Tailscale.
7. **What counts as output.** Rule 6 needs tasks to carry a deliverable flag (a published post, a finished template, a delivered client file). Without it, the output metric has nothing to count.
8. **Rollover mechanics.** Rule 4 says no automatic rollover but not what happens instead. Specify a forced triage at evening review: each unfinished task goes to tomorrow, later this week, backlog or dropped, and a postpone counter is shown after the second move.

### Weaknesses and challenged assumptions

- **Markdown and SQLite will drift if both hold live facts.** Rule: anything with a status, date or number lives only in SQLite. Daily logs and weekly reviews are rendered from the database and never parsed back. Only the brain files (strategy, context, constraints) are authored as Markdown, and the AI edits them through proposed diffs.
- **Too many rule files.** Four files under `system/` plus five under `brain/` is admin the spec says to avoid. Collapse to one `AI_INSTRUCTIONS.md` (behaviour) and three brain files. Thresholds, allocations and weights belong in a settings table, not prose.
- **"No opaque score" conflicts with "85% weekly gets pizza".** A reward needs one number. Resolve it with a declared, visible composite (default 40% execution, 30% adherence, 30% focus, editable) that always shows its three parts beside it.
- **Focus is self-reported.** The focus score measures your honesty as much as your focus. That is fine, but the UI should make an honest "diverted" as fast to submit as "completed", and never shame it.
- **Without AI, admin may kill the habit.** Phase 4 is far from day one. Add a deterministic quick-add syntax in the MVP (for example `prod: SOP template 45m tue`) so capture stays fast before the AI exists.
- **Lanes should be workstreams, not projects.** Five fixed lanes keep the swimlane readable. Projects appear as coloured tags on the cards.
- **Kanban and Gantt are not needed yet.** Status lives on the swimlane cards. Defer both until real dependency-heavy client projects exist.
- **Voice input is not local by default.** The browser's built-in speech recognition in Chrome sends audio to Google's servers. Offer it as an opt-in, with a local Whisper option later.
- **"Independent of one LLM provider" is cheap to honour.** Two adapters cover almost everything: Anthropic's API and the OpenAI-compatible format, which DeepSeek, Ollama, LM Studio and OpenRouter all speak.
- **A Claude subscription does not include API access.** The embedded chat needs a paid API key or a local model. The free alternative is to expose the same backend operations as an MCP server and talk to it from Claude Desktop or Claude Code, at the cost of the chat not being embedded in the dashboard.
- **Merge activity events and audit records.** One append-only `events` table with actor, entity, before and after covers both, and halves the code that must stay consistent.

### Decisions from Nisa (27 Nov 2026)

- **Machine and hosting:** develop and trial on the existing Dell XPS 15 9550 (Windows 10), using Node LTS and Wrangler natively on Windows. Once the MVP has been trialled, deploy to Cloudflare's free tier (Workers, D1, R2, Access). The code stays portable to plain Node and SQLite. This replaces the earlier Python and FastAPI recommendation, because Workers run TypeScript natively and Python Workers are a poor fit for the free plan's CPU limit.
- **Week:** Monday to Saturday is the default planning week. Sunday has zero capacity in the template, and work planned there counts only if you commit it. Weeks still start on Monday.
- **AI path:** free first, through a remote MCP endpoint used from Claude on your Pro plan. A local model through Ollama only works in local mode or through a tunnel, and this laptop's 2 GB GPU limits it to small models. Paid API adapters stay in the design, switched off.
- **Automation:** Activepieces is optional and is integrated after the core is deployed (section 12).
- **Repository:** a private GitHub repository holding code only. Git is used from the first commit.
- **Paid services:** none without your approval.
- **Still open:** whether to import the old Google Forms history.

## 1. Product requirements

The product succeeds if Nisa opens it every working morning, submits most time blocks the same day, and can see each Friday whether core work beat exploratory work. Everything else serves that loop.

### Users and context

One user. Developed and trialled locally on the laptop, then hosted on Cloudflare's free tier behind a login. No sharing and no other users.

### Success measures (after 4 weeks of use)

| Measure | Target |
| --- | --- |
| Working days with a committed morning plan | 80% or more |
| Time blocks submitted on the day | 85% or more |
| Median time to submit a block | under 15 seconds |
| Time spent on admin in the app per day | under 10 minutes |
| Weekly review completed | every week |

### Core loop

1. **Morning (5 min):** see yesterday's leftovers and this week's three outcomes, pick at most three priorities, lay out time blocks within today's capacity, press Commit.
2. **During the day:** start a block, work, submit it with a status, minutes and an optional note. Capture anything else in one line.
3. **Evening (5 min):** triage unfinished tasks, see today's four metrics, close the day. The daily log is written.
4. **Friday or Sunday:** weekly review shows planned against actual per workstream, neglected projects, distraction patterns and the reward result, then sets next week's three outcomes.

### Functional requirements

| Area | Requirement | Release |
| --- | --- | --- |
| Structure | Objective, project, milestone, task, time block chain with editable workstreams and allocations | MVP |
| Tasks | Create, edit, complete, estimate, deadline, deliverable flag, postpone counter, quick-add syntax | MVP |
| Ideas | Separate backlog; promote to task or project deliberately | MVP |
| Planning | Weekly capacity template, daily overrides, three weekly outcomes, at most three daily priorities, Commit snapshot | MVP |
| Swimlane | Workstream lanes by Mon to Sun, drag to reschedule, capacity bar per day, overload warning, postponed badge | MVP |
| Time blocks | Start, submit with six statuses plus auto `missed`, focused minutes, notes, follow-up | MVP |
| Metrics | Execution, focus, adherence, output per day and week, with drill-down to the underlying blocks | MVP |
| Reviews | Daily log and weekly review rendered to Markdown; evening triage of unfinished work | MVP |
| Rewards | Configurable thresholds on a visible composite | MVP |
| Safety | Backups, integrity check, undo for the last actions, JSON and CSV export | MVP |
| AI chat | Text chat that proposes typed changes with confirm controls; context pack per mode | v1 |
| AI reviews | Drafted daily and weekly narratives, project health, inactivity challenges | v1 |
| Voice | Opt-in browser speech, later local Whisper | v1 / later |
| Planning AI | Auto-drafted day plans within capacity, allocation drift warnings | v2 |
| Extras | Countdown timer, notifications, Kanban, Gantt, calendar import, phone capture | later |

### Non-functional requirements

- Works fully with the AI and automations switched off. The hosted version needs internet; local mode works offline.
- Every user action persists to SQLite before the UI confirms it.
- Page load under 1 second, any action under 200 ms on the local machine.
- No third-party calls except to the chosen AI provider and any automation webhooks you enable.
- Personal data lives only in D1, R2 and your local backups, never in the repository.

### Out of scope

Multi-user, mobile app, client billing, invoicing, file storage, email or calendar sending, and any gamification beyond scores and food rewards.

## 2. Stack and architecture

Recommended stack (revised 27 Nov for Cloudflare hosting): TypeScript on a single Cloudflare Worker using the Hono router. D1 (Cloudflare's hosted SQLite) holds the data, R2 holds backups and generated Markdown, and the plain HTML, CSS and JavaScript front end is served as the Worker's static assets. Local development runs the same code on your laptop with Wrangler, which simulates D1 and R2. There is no front-end framework, no UI build step and no Docker.

_Architecture diagram: see the living spec._

The browser, Claude through MCP, the optional embedded AI, and Activepieces (section 12) all reach data only through the operations layer, so validation and the audit trail cannot be bypassed. Cloudflare Access sits in front of every entry point.

### Stack choices

| Layer | Choice | Why | Rejected |
| --- | --- | --- | --- |
| Runtime | TypeScript on Cloudflare Workers, Hono router | Workers' native language; Hono also runs on Node, so the app can leave Cloudflare | Python Workers (needs a compatibility flag, runs on Pyodide, tight against the free plan's 10 ms CPU limit); FastAPI (no longer fits the host) |
| Local dev | Wrangler (`wrangler dev`) with Node LTS on native Windows | Same code, local D1 and R2, no account needed, works offline | A separate local stack |
| Database | D1 with plain SQL migrations (`wrangler d1 migrations`) | It is SQLite, so the schema in section 3 carries over unchanged | ORM, Postgres |
| Atomic writes | `db.batch()` of prepared statements per operation | D1 has no interactive transactions; a batch is all-or-nothing | Multi-request writes |
| Validation | Zod schemas shared by REST routes, AI operations and the MCP endpoint | One definition of a valid change | Separate schemas per caller |
| Front end | Vanilla JS ES modules, one CSS file, hand-drawn SVG, served as Worker static assets | Same origin as the API (no CORS), one deploy | Cloudflare Pages plus a separate Worker (two deploys, cross-origin calls) |
| Files | R2 for backups, exports and rendered Markdown | S3-compatible, free egress | Files stored in D1 |
| Auth | Cloudflare Access in front of everything, plus a JWT check inside the Worker | Free for up to 50 users; no login code to write | Hand-rolled login |
| Scheduling | Cron Triggers for the automatic day close | Free (5 per account) | External schedulers |
| Search | SQLite FTS5 in D1 | Built in | Vector database |
| AI | Remote MCP endpoint first, then two adapters (Anthropic, OpenAI-compatible) | No provider lock-in | Agent frameworks |
| Tests | Vitest with Cloudflare's Workers test pool | Runs against a local D1 | Mocked database |

### How the AI changes data safely

The AI never touches SQL or files directly. It can only call a fixed list of typed operations, the same ones the REST API uses.

1. The backend builds a context pack for the current mode and sends it with the user's message and the operation list as tools.
2. The model replies with text plus zero or more proposed operations, for example `complete_task`, `create_task`, `log_decision`.
3. Each operation is validated: schema (Pydantic), references exist, business rules hold (capacity, at most three priorities, no duplicate task), and its risk tier is looked up.
4. Tier A operations (record completion, record a submission, add a note, capture an idea) apply at once and show as a dismissible card with Undo.
5. Tier B operations (new project, change priority, move a deadline, archive, change more than two blocks in a committed plan) wait as a proposal card with Accept, Edit and Reject.
6. Every applied operation writes an `events` row with actor `ai`, the proposal id, and before and after values, which is what makes Undo and the audit trail work.
7. Invalid operations are returned to the model once with the error so it can correct itself; a second failure is shown to the user as text, never applied.

If the provider is down, the chat panel says so and everything else keeps working, because the UI never depends on the AI for any write.

### Free AI path: remote MCP

The Worker also serves the operation list as a remote MCP endpoint. A custom connector in Claude can reach it from Claude Desktop, the web or the phone app, so it uses your Pro plan with no API credits, and it gives you phone capture as a bonus (check custom-connector availability in your Claude settings). The endpoint needs its own OAuth login, which Cloudflare's open-source `workers-oauth-provider` library handles. The embedded chat, using a paid API key or a local model, stays optional and can be added at any time.

### Cloudflare free tier: evaluation

The app fits Cloudflare's free plan with a wide margin. The real trade-off is that it becomes cloud-hosted and needs an internet connection, which softens the spec's local-first principle. Limits below are from Cloudflare's docs, checked 27 Nov 2026.

| Service | Use here | Free-plan limit | Expected use |
| --- | --- | --- | --- |
| [Workers](https://developers.cloudflare.com/workers/platform/limits/) | API, static front end, cron | 100,000 requests a day; 10 ms CPU per request or cron run; 5 cron triggers | A few thousand requests a day; ordinary reads and writes take well under 10 ms |
| [D1](https://developers.cloudflare.com/d1/platform/pricing/) | Operational database | 5 GB storage; 5 million rows read and 100,000 rows written a day | Tens of MB a year; a few hundred writes a day |
| [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) | Point-in-time restore | Last 7 days, always on | Undo for bad deploys or bulk mistakes |
| [R2](https://developers.cloudflare.com/r2/pricing/) | Backups, exports, Markdown | 10 GB-month; 1 million writes and 10 million reads a month; free egress | Under 1 GB a year |
| [Access](https://www.cloudflare.com/plans/sase-zero-trust.md) | Login in front of the app | Free for 50 users | 1 user |
| Pages | Not used | n/a | Replaced by the Worker's static assets: one deploy, one origin, one Access rule |

What happens at a limit: since 1 Sept 2026, D1 queries on the free plan [fail until 00:00 UTC](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) once a daily read or write limit is passed. Stored data is not affected. The settings page will show today's D1 usage and warn at 70%. Every list query will be indexed, so it is hard to get anywhere near the limit.

Trade-offs to accept knowingly:

- **Data leaves your laptop.** It is stored on Cloudflare (encrypted at rest). Check that your client agreements allow client names and project details to sit with a cloud provider.
- **No internet, no app.** Local mode works offline, but it uses a separate database and does not sync. Hosted is the primary copy. Local is for development and for emergencies, restored from the latest backup.
- **A card may be requested.** R2 and Zero Trust sign-up have asked for a payment method even on free plans. The docs I read don't confirm this either way. If asked, add billing alerts. Nothing is charged within the free limits.

### Portability and lock-in

All Cloudflare-specific code lives in one folder, `src/platform/`. Everything else talks to two small interfaces, `Db` and `FileStore`.

| Cloudflare piece | Portable replacement, same app code |
| --- | --- |
| Workers + Hono | Hono on Node (`@hono/node-server`) on any machine |
| D1 | A plain SQLite file through Node's built-in `node:sqlite` |
| R2 | Any S3-compatible store, or a local folder |
| Access | Any auth proxy (for example Tailscale), or a built-in passkey login |
| Cron Triggers | The operating system's scheduler calling the same endpoint |

Exit procedure: `wrangler d1 export` produces a SQL file, which loads into SQLite. Then start the Node build.

### Security and authentication

1. **Cloudflare Access** protects the app's hostname. The `workers.dev` and preview URLs are turned off so nothing bypasses it. The policy allows only your email address, with login by one-time email code or GitHub. Sessions last 7 days on your own devices.
2. **The Worker checks the Access JWT** (`Cf-Access-Jwt-Assertion` header) on every request: the signature against your team's keys, plus the audience tag. A misconfigured route therefore still cannot expose data.
3. **The MCP endpoint** uses its own OAuth flow with revocable tokens, and can only call the same validated operations.
4. **Secrets** (API keys, OAuth signing keys) are set with `wrangler secret put` and never committed. Local secrets go in `.dev.vars`, which is git-ignored.
5. **Headers:** a strict Content Security Policy (own origin only, no third-party scripts), HSTS, and `X-Content-Type-Options`.
6. **Accounts:** two-factor authentication on Cloudflare and GitHub. The deploy API token is limited to this Worker, its D1 database and its R2 bucket. The repository is private, with GitHub secret scanning on.

### Backup, restore and export procedures

| Layer | What | When | Kept | Restore |
| --- | --- | --- | --- | --- |
| D1 Time Travel | Point-in-time copy of the database | Continuous, automatic | 7 days | `wrangler d1 time-travel restore` to a timestamp |
| Nightly export | GitHub Actions runs `wrangler d1 export --remote` and uploads the SQL file to R2 | Daily, 03:00 | 14 daily, 8 weekly, 12 monthly | Load the file into a new D1 database, then switch the binding |
| Off-Cloudflare copy | `npm run backup:pull` downloads the latest export and the Markdown from R2 to your laptop | Weekly, prompted during the weekly review | All | Same, or open the SQL file locally |
| Pre-deploy | An export runs before every remote migration | Every deploy | Last 10 | Same |

The nightly export runs in GitHub Actions, not a Worker cron job. A full dump could pass the 10 ms CPU limit as the data grows, and Actions minutes on a private repository are free up to a monthly allowance. Once a month, run a restore drill: load the latest export into a scratch database and compare row counts. Before deploying, re-check Cloudflare's current D1 and R2 free-tier limits.

**Export for you:** the Review screen offers JSON (all tables) and CSV per table, fetched page by page to stay within CPU limits. Rendered daily, weekly and monthly Markdown is always downloadable from R2.

### Deployment procedure

1. Run `npm test` locally. It must pass.
2. Push to the private GitHub repository. CI runs the tests again.
3. Run `npm run deploy`, which exports a backup, applies pending migrations with `wrangler d1 migrations apply --remote`, then runs `wrangler deploy`.

Deploy from the laptop at first. Automatic deploys from GitHub can come later, if they're ever wanted.

## 3. SQLite schema

Twenty tables plus one search index, all keyed by ULID text ids (sortable by creation time), with UTC ISO-8601 timestamps plus a separate local `day` column wherever a record belongs to a calendar day. `PRAGMA foreign_keys=ON` and `journal_mode=WAL` are set for local SQLite (D1 enforces foreign keys by default and manages its own journal). Nothing is hard-deleted: records carry `archived_at`, and every change writes an `events` row.

```sql
-- Configuration ------------------------------------------------------
CREATE TABLE settings (
  key TEXT PRIMARY KEY,            -- e.g. reward.pizza_threshold, score.weights, day_close_time
  value TEXT NOT NULL              -- JSON
);

CREATE TABLE workstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,       -- Business development, Production, Client delivery, AI research, Admin
  colour TEXT NOT NULL,
  daily_target_min INTEGER NOT NULL DEFAULT 0,
  is_core INTEGER NOT NULL DEFAULT 0,   -- 1 = protected by Rule 7
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT
);

CREATE TABLE capacity_template (    -- normal working week
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),  -- 0 = Monday
  available_min INTEGER NOT NULL,
  start_time TEXT, end_time TEXT
);

CREATE TABLE days (                -- one row per calendar day used
  day TEXT PRIMARY KEY,            -- YYYY-MM-DD local
  available_min INTEGER NOT NULL,  -- copied from template, then overridden
  day_type TEXT NOT NULL DEFAULT 'work' CHECK (day_type IN ('work','leave','sick','light')),
  committed_at TEXT,               -- morning Commit; null = not committed
  plan_snapshot TEXT,              -- JSON of blocks and priorities at commit
  closed_at TEXT                   -- evening close
);

-- Strategy -----------------------------------------------------------
CREATE TABLE objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  horizon TEXT CHECK (horizon IN ('quarter','year','multi_year')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','dropped')),
  created_at TEXT NOT NULL, archived_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,       -- also the vault file name
  title TEXT NOT NULL,
  description TEXT,
  objective_id TEXT REFERENCES objectives(id),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  client_name TEXT,                -- set for client delivery
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','blocked','done','abandoned')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  due_day TEXT,
  health_note TEXT,
  last_activity_at TEXT,           -- maintained by triggers on tasks and submissions
  created_at TEXT NOT NULL, archived_at TEXT
);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  due_day TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  done_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE weekly_outcomes (     -- Rule 3
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,              -- ISO week, e.g. 2026-W48
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','partly','missed')),
  UNIQUE (week, position)
);

-- Work ---------------------------------------------------------------
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  project_id TEXT REFERENCES projects(id),
  milestone_id TEXT REFERENCES milestones(id),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','done','dropped','backlog')),
  estimate_min INTEGER,
  planned_day TEXT,                -- swimlane column; null = unscheduled
  due_day TEXT,
  is_deliverable INTEGER NOT NULL DEFAULT 0,  -- counts as output when done
  is_priority INTEGER NOT NULL DEFAULT 0,     -- one of today's max 3
  postpone_count INTEGER NOT NULL DEFAULT 0,
  parent_task_id TEXT REFERENCES tasks(id),   -- follow-ups point at their origin
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','quick_add')),
  done_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX tasks_day ON tasks(planned_day, workstream_id);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_id TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);

CREATE TABLE time_blocks (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL REFERENCES days(day),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  task_id TEXT REFERENCES tasks(id),          -- optional primary task
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  sched_start TEXT NOT NULL, sched_end TEXT NOT NULL,   -- local datetimes
  planned_min INTEGER NOT NULL CHECK (planned_min > 0),
  in_commit INTEGER NOT NULL DEFAULT 0,       -- 1 = part of the committed plan
  rescheduled_from_id TEXT REFERENCES time_blocks(id),
  state TEXT NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned','active','submitted','rescheduled','missed','cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX blocks_day ON time_blocks(day);

CREATE TABLE block_submissions (   -- one live row per block; edits keep history in events
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL UNIQUE REFERENCES time_blocks(id),
  status TEXT NOT NULL CHECK (status IN
    ('completed','partial','diverted','interrupted','rescheduled','skipped','missed')),
  actual_start TEXT, actual_end TEXT,
  focused_min INTEGER NOT NULL DEFAULT 0 CHECK (focused_min >= 0),
  interruption_kind TEXT CHECK (interruption_kind IN ('client','urgent','technical','personal','other')),
  diverted_to TEXT,                -- free text or a workstream name
  notes TEXT,
  submitted_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','system'))
);

-- Memory -------------------------------------------------------------
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL, notes TEXT,
  kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea','possible_project','opportunity')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','promoted','parked','dropped')),
  promoted_to_type TEXT, promoted_to_id TEXT,
  mention_count INTEGER NOT NULL DEFAULT 1,   -- feeds Rule 5
  created_at TEXT NOT NULL
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL, rationale TEXT,
  supersedes_id TEXT REFERENCES decisions(id),
  created_at TEXT NOT NULL
);

CREATE TABLE notes (               -- blockers, observations, accomplishments
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocker','observation','accomplishment','priority_change')),
  project_id TEXT REFERENCES projects(id),
  body TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE reviews (             -- daily, weekly, monthly in one table
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('day','week','month')),
  period TEXT NOT NULL,            -- 2026-11-27 | 2026-W48 | 2026-11
  metrics TEXT NOT NULL,           -- JSON snapshot of computed metrics
  narrative TEXT,                  -- user or AI written summary
  recommendations TEXT,
  reward TEXT,                     -- pizza | burger | kebab | reset | null
  markdown_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (period_type, period)
);

-- History and AI -----------------------------------------------------
CREATE TABLE events (              -- append-only activity log and audit trail
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user','ai','automation','agent','system')),
  op TEXT NOT NULL,                -- e.g. task.complete, block.submit
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  before_json TEXT, after_json TEXT,
  proposal_id TEXT REFERENCES ai_proposals(id),
  undone_by TEXT REFERENCES events(id)
);
CREATE INDEX events_day ON events(day);
CREATE INDEX events_entity ON events(entity_type, entity_id);
CREATE TRIGGER events_no_update BEFORE UPDATE OF at, op, before_json, after_json ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('morning','running','evening','weekly','admin')),
  day TEXT NOT NULL,
  provider TEXT, model TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id),
  op TEXT NOT NULL,
  args TEXT NOT NULL,              -- JSON, validated
  tier TEXT NOT NULL CHECK (tier IN ('A','B')),
  status TEXT NOT NULL CHECK (status IN ('applied','pending','accepted','rejected','invalid','undone')),
  explanation TEXT,                -- Rule 9: why
  error TEXT,
  created_at TEXT NOT NULL, resolved_at TEXT
);

CREATE VIRTUAL TABLE search USING fts5(entity_type, entity_id UNINDEXED, day UNINDEXED, body);
```

### Design notes

- **Objective to daily action** is `objectives` to `projects` to `milestones` to `tasks` to `time_blocks` to `block_submissions`. Milestone and project are optional on a task, so quick capture never forces a choice.
- **History vs current state:** current state lives in the entity tables; history lives in `events`, `block_submissions`, `decisions`, `notes` and `reviews`. Decisions are never edited, only superseded.
- **Rescheduling** creates a new block with `rescheduled_from_id` and marks the old one `rescheduled`, so the original committed plan is never rewritten.
- **Reviews in one table** with `period_type` replaces separate daily and weekly tables; the metrics JSON is a frozen snapshot, so later edits do not silently change past weeks.
- **The reward and score formulas** live in `settings` so they can change without migrations; each review stores the weights it was computed with.

### Later migrations for context management

Four tables arrive with the AI milestones, not in M1. The DDL is in section 5 of the [context management doc](https://claude.ai/artifact/ABiouk3JvhpCpsBEdnD6cP).

| Table | Milestone | Purpose |
| --- | --- | --- |
| `artifacts` | M5 | Large tool outputs kept whole, deduplicated by hash, body inline or in R2 |
| `context_packs` | M5 | What each pack contained and its token count, for benchmarks |
| `checkpoints` | M5 | Session state of at most 2 KB per mode, for `resume(mode)` |
| `summaries` | M6 | Master, objective, project and milestone summaries, marked stale when newer events exist |

M1 already lays the foundations: ULIDs, the append-only events, the FTS5 `search` table and frozen reviews. Two small additions are in the M1 prompt: keep `search` filled from the ops layer, and put an `id:` field in the front matter of generated Markdown.

## 4. Folder structure

Code and personal data live in two separate folders. The code folder becomes the git repository; the data folder never goes into git and is the only thing you need to back up.

```text
personal-os/                      # code only, private GitHub repository
  CLAUDE.md                       # rules for Claude Code working on the app
  package.json  tsconfig.json
  wrangler.jsonc                  # Worker, D1, R2, cron, static assets bindings
  .dev.vars.example               # names of local secrets, no values
  .gitignore                      # .wrangler/, .dev.vars, node_modules/, *.sqlite, backups/
  migrations/
    0001_init.sql                 # section 3 schema
  src/
    index.ts                      # Hono app: routes, cron handler, static assets
    db.ts                         # Db and FileStore interfaces
    platform/                     # the only Cloudflare-specific code
      cloudflare.ts               # D1Db, R2Store, Access JWT check
      node.ts                     # SqliteDb (node:sqlite), FsStore, for leaving Cloudflare
    ops/                          # the single list of allowed operations
      registry.ts                 # op name -> Zod schema, handler, risk tier
      tasks.ts  blocks.ts  planning.ts  projects.ts  memory.ts
    services/
      metrics.ts                  # the four metrics, pure functions
      capacity.ts  reviews.ts  markdown.ts  quickadd.ts  export.ts
    api/                          # thin routes that call ops/
      today.ts  week.ts  projects.ts  review.ts  chat.ts  settings.ts
    ai/
      mcp.ts                      # remote MCP endpoint over ops/
      context.ts  chat.ts
      providers/anthropic.ts  providers/openai-compat.ts
    integrations/                 # added in milestone A (section 12)
      outbox.ts  webhooks.ts  inbound.ts
  public/                         # static front end, no build step
    index.html
    css/app.css
    js/  main.js  api.js  today.js  week.js  projects.js  review.js  chat.js  svg.js
  test/
    metrics.test.ts  ops.test.ts  api.test.ts  auth.test.ts  backup.test.ts  fixtures/  ai-golden/
  scripts/
    backup-pull.ts  restore.ts  seed.ts  deploy.ts
  .github/workflows/
    ci.yml                        # tests on every push
    nightly-backup.yml            # wrangler d1 export --remote -> R2

PersonalOS-data/                  # on the laptop, outside the repo
  backups/                        # weekly pulls of D1 exports
  vault/                          # Markdown mirror pulled from R2
    brain/  projects/  daily/2026/11/2026-11-27.md  weekly/2026-W48.md  monthly/
  exports/
```

Workers have no file system, so the Markdown memory layer moves. Brain files (AI\_INSTRUCTIONS, MASTER\_CONTEXT, OBJECTIVES, OPERATING\_RULES) and project narratives are stored in a `documents` table in D1, with every version kept, and edited in the app. You edit them directly; the AI edits them only through accepted diffs. Daily, weekly and monthly logs are rendered to Markdown in R2 at each close and are never parsed back. `backup:pull` mirrors all of it into `PersonalOS-data/vault/` on the laptop, so a readable copy always exists off Cloudflare. In local development, Wrangler keeps its D1 and R2 state in `.wrangler/`, which is git-ignored.

Schema addition for this: `documents (id, path UNIQUE, body, version, updated_at, updated_by)` plus `document_versions (document_id, version, body, created_at, actor)`.

## 5. Screen and layout spec

One page, four views (Today, Week, Projects, Review) under a persistent top bar, with the chat as a collapsible right rail. The current or next time block is always visible, because that is where accountability happens.

_Today view wireframe: see the living spec._

The Week, Projects and Review views replace the main area; the top bar and chat rail stay put.

### Persistent elements

- **Top bar:** date and ISO week; the Now card (current block, workstream colour, elapsed time, Submit button) or the Next card if nothing is active; today's four metric chips; reward progress for the week; quick-add field (shortcut `/` or Ctrl+K).
- **Chat rail (360 px, collapsible):** mode switch (Morning, Running, Evening, Weekly), message history, proposal cards with Accept, Edit, Reject, and applied-change cards with Undo. Hidden entirely when no AI is configured.
- **Toasts:** every write shows a short confirmation with Undo for 10 seconds.

### Today view

| Region | Contents |
| --- | --- |
| Header strip | Three priorities (checkbox each), plan state: Draft, Committed, Closed |
| Left column, 60% | Vertical timeline of today's blocks in scheduled order; each shows title, workstream colour, planned minutes, status chip. Clicking opens the submit sheet. Free capacity shown as dashed gaps. |
| Right column, 40% | Tasks for today grouped by workstream with checkboxes; unscheduled tasks under each group; capacity bar (planned minutes vs available). |
| Footer actions | Commit plan (morning), Close day (evening, opens triage). |

### Week view: the swimlane

| Element | Behaviour |
| --- | --- |
| Rows | Workstreams in `sort_order`, core workstreams marked |
| Columns | Monday to Sunday (the Sunday column is narrow unless it holds work) |
| Cards | Task title, estimate, project tag, status tick; `↻2` badge when postponed twice or more |
| Day header | Planned minutes / available minutes; turns amber over 90% and red over 100% |
| Row footer | Planned hours vs the workstream's weekly target, so allocation drift is visible |
| Top strip | The three weekly outcomes with status |
| Interaction | Drag a card to another day or lane; drop on Backlog to unschedule; double-click empty cell to add |

### Projects view

A register table (title, workstream, status, priority, next milestone, open tasks, health, last activity), sorted by priority then last activity. Stale projects (no activity in 14 days while active) are flagged. Clicking a row opens a side drawer with objective, milestones, task list, decisions, recent events, and the project's Markdown narrative.

### Review view

Day and Week tabs. Each shows the four metrics as separate tiles with the counts behind them, a planned-versus-actual bar per workstream, a list of diverted blocks with their notes, outputs produced, and the reward result with its formula. Every number links to the blocks it was computed from.

### Submit sheet (the most-used control)

A bottom sheet with six large status buttons, a focused-minutes field pre-filled with the planned minutes (or the elapsed minutes if the block was started), an optional one-line note, and Submit. Diverted asks "to what?" with workstream chips. Interrupted asks for the kind. Keyboard: 1 to 6 for status, Enter to submit. Target: three clicks and under 15 seconds.

### Visual style

Dark background (near-black blue-grey), one accent colour, workstream colours used only as thin left borders and tags. Inter or system UI font, tabular numbers for metrics. No gradients, no badges, no confetti. Motion limited to 150 ms transitions. Layout works from 1280 px wide; below 900 px the chat rail becomes an overlay.

## 6. AI instruction and memory strategy

The backend, not the model, decides what the AI sees and what it may change. The model gets a small, fresh context pack built from the database each turn, so nothing important depends on chat history surviving.

### Context pack per mode

| Item | Morning | Running | Evening | Weekly | Size cap |
| --- | --- | --- | --- | --- | --- |
| AI\_INSTRUCTIONS.md | yes | yes | yes | yes | 1,500 words |
| MASTER\_CONTEXT.md, OBJECTIVES.md, OPERATING\_RULES.md | yes | summary | summary | yes | 2,000 words |
| Workstreams with targets, settings | yes | yes | yes | yes | small |
| Active projects: one line each (status, next milestone, last activity) | yes | yes | yes | yes | 40 lines |
| This week's outcomes and swimlane | yes | yes | yes | yes | generated |
| Today's blocks, submissions, priorities | yes | yes | yes | no | generated |
| Yesterday's daily review | yes | no | no | no | 400 words |
| Unfinished tasks with postpone counts | yes | no | yes | yes | 30 items |
| This week's daily reviews | no | no | no | yes | 7 x 300 words |
| Project narrative + last 20 events | when named | when named | when named | stale ones | per project |
| FTS5 search hits | no | on demand | no | no | 10 snippets |

"When named" means the backend matches project slugs, titles and aliases in the user's message before calling the model. The model can also call a read-only `search_history` tool. No embeddings or vector store are needed at this scale.

### AI\_INSTRUCTIONS.md outline

1. **Role:** chief of staff for one person; direct, brief, never flattering; explains each recommendation in one sentence (Rule 9).
2. **Source of truth:** the context pack and tools are the facts. If a fact is not there, ask or search; never assume from memory of earlier chats.
3. **Classification:** every statement is one of idea, possible project, commitment, task, milestone, project, decision, blocker, completed activity, or change in circumstances. Ideas and possible projects go only to the ideas backlog. Ask before turning a vague intention into a task.
4. **Operations:** change data only through the provided operations; batch related changes; check for an existing task before creating one.
5. **The ten operating rules,** restated as checks the model runs before proposing a plan: capacity, at most three priorities, three weekly outcomes, rollover triage, inactivity challenge, activity versus output, core-work protection, idea backlog, explanation, fairness to legitimate interruptions.
6. **Tone for accountability:** name the pattern, give the number, propose one change. No lectures.
7. **Mode scripts:** the questions and outputs expected in morning, running, evening and weekly modes.

### Operation list and risk tiers

| Tier A: applied at once, undoable | Tier B: needs confirmation |
| --- | --- |
| `complete_task`, `submit_block`, `set_focused_minutes` | `create_project`, `archive_project`, `set_project_status` |
| `add_note` (observation, blocker, accomplishment) | `set_priority`, `set_weekly_outcome` |
| `capture_idea`, `bump_idea_mention` | `move_deadline`, `create_milestone` |
| `create_task` when unscheduled and not a deliverable | `create_task` when scheduled, deliverable, or with a deadline |
| `log_decision` on an existing project | `schedule_blocks` / `move_block` after commit (more than 2 blocks) |
| `link_follow_up` | `propose_brain_edit` (diff to a brain file) |
| read-only: `search_history`, `get_project`, `get_day` | `promote_idea` |

### Consolidation processes

**Continuous.** Every operation writes its entity change and an `events` row in one transaction. Nothing waits for the end of the day.

**Daily close** (evening review, or automatically at the day-close time if skipped):

1. Mark unsubmitted blocks `missed`.
2. Triage each unfinished task for today: tomorrow, later this week, backlog, or drop. Moving it increments `postpone_count`.
3. Compute and freeze day metrics into `reviews`.
4. Optional AI step: draft a 150-word narrative from today's events and submissions; you edit or accept.
5. Render `daily/YYYY/MM/YYYY-MM-DD.md` from the review and events.
6. Update each touched project's generated status block in its Markdown file.
7. Propose tomorrow's draft plan (AI if available, otherwise carry triaged tasks into tomorrow's draft).

**Weekly close** (Friday afternoon or Sunday):

1. Freeze week metrics; mark each weekly outcome met, partly or missed.
2. Compare planned against actual minutes per workstream and flag core workstreams under 70% of target.
3. List projects active but untouched this week; list tasks postponed 3 or more times; list ideas mentioned 3 or more times without promotion (Rule 5).
4. Summarise diverted-block notes into patterns (time of day, workstream, diverted-to).
5. Compute the reward; draft next week's three outcomes; render `weekly/YYYY-Www.md`.

**Monthly strategic review** (first working day of the month, about 20 minutes):

1. Read the month's weekly reviews and the brain files.
2. Propose diffs to OBJECTIVES.md and MASTER\_CONTEXT.md, each with a reason; you accept or reject each hunk.
3. Propose archiving stale projects and dropping stale ideas (Tier B).
4. Render `monthly/YYYY-MM.md`.

The brain files therefore change slowly and deliberately, and the master context never grows by appending conversation.

### Context engineering and token optimisation

The full research and benchmark design are in the companion doc [Personal OS: Context management and token optimisation](https://claude.ai/artifact/ABiouk3JvhpCpsBEdnD6cP). The rules that shape the design are:

- **Progressive disclosure, levels L0 to L4:** the pack starts with one-line references (L0) and the AI asks for more detail (L1 summary, L2 record, L3 history, L4 full original) only when it needs it.
- **IDs, not copies:** tools return stable ULIDs and short labels, and the model cites them instead of repeating text.
- **List before detail:** every read tool has a list form; full records come from a second call.
- **4 KB reply cap:** a tool result larger than 4 KB is stored whole as an artifact, and the model gets a summary plus a pointer it can open.
- **Snippet-only search:** FTS5 returns ranked snippets with ids, never whole documents.
- **Duplicate stubs:** content already sent in this conversation is replaced by a reference to its earlier copy.
- **`resume(mode)`:** a tool that restores the last checkpoint for that mode, so a new chat starts from a 2 KB state, not from history.

All of this is provider-independent: it lives in the context builder and tool layer, not in any model's features. Provider caching is used where available as a bonus, never relied on.

## 7. Time-block accountability spec

A block is planned, optionally started, and always ends with exactly one submission, either from you or as `missed` at day close. All four metrics are computed from those submissions against the committed plan snapshot, never from what the plan looks like later.

### Block lifecycle

| State | Set by | Next states |
| --- | --- | --- |
| `planned` | creating the block | `active`, `submitted`, `rescheduled`, `cancelled` |
| `active` | Start button (records `actual_start`) | `submitted` |
| `submitted` | Submit sheet or an AI `submit_block` | (edits allowed; each edit logged in `events`) |
| `rescheduled` | moving a committed block; a new block is created with `rescheduled_from_id` | none |
| `cancelled` | deleting a block before commit | none |
| `missed` | day close, when no submission exists | a late submission is still allowed and logged |

### Submission statuses

| Status | Meaning | Counts against you? |
| --- | --- | --- |
| Completed | Did the planned work | No |
| Partial | Worked on it, not finished | Partly |
| Diverted | Self-directed switch to something else; asks what | Yes |
| Interrupted | External cause; asks kind: client, urgent, technical, personal, other | Client and urgent are excused; others count |
| Rescheduled | Moved before starting | Adherence only |
| Skipped | Chose not to do it | Yes |
| Missed | No submission by day close | Yes |

### Submission data flow

Using the spec's example (completed, 40 focused minutes, note about the screen-recording animation):

1. Submit sheet posts `{block_id, status: completed, focused_min: 40, notes}` to `POST /api/blocks/{id}/submit`.
2. In one transaction: insert `block_submissions`, set block state `submitted`, set `actual_end` to now, update the linked task (completed marks it `done` unless you untick "task finished"), update `projects.last_activity_at`, write an `events` row.
3. The UI updates the Now card, timeline and metric chips from the response; no reload.
4. If the note contains follow-up language and AI is on, the backend asks the model for a follow-up: it searches open tasks in the same project for a near match (title similarity over 0.8 means link, not create) and returns either `link_follow_up` (Tier A) or `create_task` with `parent_task_id` set. Without AI, the sheet has a "Needs another session" tick that creates the follow-up task directly.
5. The submission appears in today's events and therefore in the daily log at close.

Planned minutes, elapsed minutes (`actual_end` minus `actual_start`) and focused minutes are stored separately and never inferred from each other.

### Metric definitions

For a period (day or week), let K be the blocks in the committed snapshot, X the excused blocks in K (interrupted by client or urgent, or on a leave or sick day), and S the started blocks (completed, partial, diverted, interrupted). Blocks added after commit count towards focus and output, not adherence.

**Execution:** did you finish what you committed to? T is the set of tasks in the commit snapshot.

```latex
\text{Execution} = \frac{|T_{done}| + 0.5\,|T_{partial}|}{|T| - |T_{excused}|}
```

**Focus:** how much of the time you sat down for went to the intended work. Interrupted blocks count only up to the interruption.

```latex
\text{Focus} = \frac{\sum_{b \in S} \min(\text{focused}_b,\ \text{planned}_b)}{\sum_{b \in S} \text{planned}_b^{*}}
```

where planned\* is the planned minutes, or elapsed minutes for an interrupted block.

**Schedule adherence:** did you follow the plan you committed to? A block adheres if its status is completed or partial, it was not rescheduled, and (when started) it began within 15 minutes of its scheduled start.

```latex
\text{Adherence} = \frac{|\{b \in K \setminus X : b \text{ adheres}\}|}{|K \setminus X|}
```

**Output:** a count, not a percentage: deliverable tasks completed in the period, listed by name, with the weekly output target from settings shown beside it.

**Weekly composite (for rewards only):** default weights, editable, always shown with its parts.

```latex
\text{Composite} = 0.4\,\text{Execution} + 0.3\,\text{Adherence} + 0.3\,\text{Focus}
```

Default rewards: 85% or more is Pizza, 75% or more is Burger or Kebab, below 75% is Review and reset. A week with fewer than 10 committed blocks shows the composite but awards nothing, so a light week cannot be gamed.

### Weekly report table

The Review view and the weekly Markdown file show this table, every row a count from the database:

| Metric | Source |
| --- | --- |
| Scheduled blocks (committed) | count of K |
| Completed as planned | adhering blocks |
| Partially completed | status partial |
| Diverted | status diverted, with diverted-to breakdown |
| Interrupted (excused / not excused) | status interrupted by kind |
| Rescheduled | state rescheduled |
| Skipped or missed | status skipped or missed |
| Actual focused time | sum of focused minutes, in hours |
| Focused time by workstream vs target | per workstream |
| Outputs | deliverable tasks done, listed |

### Timing modes

MVP: manual Start and Submit, with elapsed time shown on the Now card. Later: countdown with a browser notification at block end, and a reminder if a block's end passes 10 minutes without a submission. Both use the free browser Notification API.

## 8. MVP roadmap

The MVP is milestones 1 to 4: the full accountability loop with no AI. Use it for two real weeks before starting AI work, because that use will change what the AI should do.

Milestones run strictly in order, and each ends with a working app you can use. M5 starts only after the two-week trial of M4.

| Milestone | Scope | Done when |
| --- | --- | --- |
| M1 Foundation | Repo, Wrangler config, migrations, ops registry, workstreams, objectives, projects, milestones, tasks, ideas, documents, events, JSON and CSV export, all against local D1 | All ops covered by tests; export round-trip passes; seed script loads your workstreams |
| M2 Today and Week | Page shell and top bar, Today view, swimlane with drag, capacity template (Mon to Sat) and overrides, quick-add parser, three priorities, Commit snapshot, Undo toasts | You can plan a real week in under 10 minutes; overloaded days turn red |
| M3 Time blocks | Blocks on the timeline, Start, submit sheet, statuses, missed at close, follow-up tick, evening triage, day metrics, daily Markdown to R2 | A block submits in under 15 seconds; metrics match a hand-calculated test day |
| M4 Review | Weekly close, Review view, weekly Markdown, projects register and drawer, stale flags, rewards | One full week reviewed from real data. MVP gate: two weeks of local use |
| D Deploy | Cloudflare account setup, Access policy, JWT check, secrets, nightly backup workflow, `backup:pull`, restore drill, move the trial data to remote D1 | App reachable only after login; a restore drill passes; zero paid services |
| M5 AI via MCP | Remote MCP endpoint with OAuth, context pack, ops as tools, Tier A and B proposals, then optional embedded chat adapters | Golden transcripts produce the expected ops; with AI off, the app is fully usable |
| A Automation | Outbox, signed outbound webhooks, inbound API with scoped tokens and idempotency, automation settings page, first Activepieces flows (section 12) | Disabling Activepieces changes nothing in the core; duplicate deliveries are ignored |
| G Agent delegation | AgentProvider contract with manual and OpenBot adapters, assignment tracking, dispatch approval, agent reports back as Tier B proposals (section 13). Needs D and A | One delegated research task runs end to end and its report lands on the right task; with OpenBot off, nothing breaks |
| M6 AI reviews and planning | Drafted daily and weekly narratives, draft day plans within capacity, inactivity and drift challenges, brain-document diffs, opt-in voice | Morning briefing produces a plan you can commit after only small edits |
| M7 Refinement | Countdown and notifications, Kanban and Gantt views, calendar import, local Whisper | Driven by what two months of use show is missing |

Context optimisation rolls out in stages alongside M5 to M7. Each stage is kept only if the benchmark in section 10 shows it earns its place. Vector search is deferred to M7 or later, and is added only if FTS5 finds fewer than 85% of the relevant records in its top 10 results.

## 9. Paid services and external dependencies

Nothing in the plan needs a paid service. Cloudflare's free tier covers hosting, and the free AI route uses your existing Claude Pro plan. Activepieces runs locally for free. Each paid option below needs your approval first.

| Feature | Option | Cost | Notes |
| --- | --- | --- | --- |
| Hosting | Cloudflare Workers, D1, R2, Access free tiers | Free | Limits in section 2. A payment method may be requested at sign-up for R2 or Zero Trust. |
| Hosting upgrade | Workers Paid | $5 a month | Only if a free limit is hit; also unlocks 30-day Time Travel and Containers. |
| Domain | A custom domain for the app | About the price of a domain a year | Optional; Access works on a domain you add to Cloudflare. |
| AI | Remote MCP from Claude (Pro plan) | Covered by your existing subscription | Free primary route. |
| AI | Anthropic API | Paid per token | Separate from Pro; needs its own key and billing. |
| AI | DeepSeek API | Paid per token, low | OpenAI-compatible; read its data terms before sending client details. |
| AI | Local model via Ollama | Free | Only in local mode or through a tunnel; small models on this laptop. |
| Automation | Activepieces in Docker on the laptop | Free | Runs only while the laptop is on (section 12). |
| Automation | Small always-on server for Activepieces | Roughly $5 to $10 a month for a 4 GB machine | Later, if laptop-only automation proves limiting. |
| Voice | Browser speech recognition | Free | Audio goes to the browser vendor's servers. Opt-in. |
| Voice | Local Whisper | Free | Local mode only; later milestone. |
| Backups off Cloudflare | GitHub Actions + laptop pull | Free | Within GitHub's free Actions minutes for private repos. |

Token-reduction projects reviewed: Context Mode (Elastic License 2.0), TokenSaver (MIT) and the Awesome LLM Token Reduction list (CC0). None of them becomes a runtime dependency. The Context Mode Gateway is a paid proxy and is excluded. Context Mode may be used optionally as a Claude Code plugin while developing the app, never inside it.

AI cost control built in: the context pack is capped per mode, conversations are short-lived per day, and a monthly token budget in settings shows usage in the chat rail and stops calls when reached.

## 10. Testing and reliability strategy

The two things that must never break are "a submitted block is saved" and "the metrics are right", so they get the most testing. Tests run with Vitest in Cloudflare's Workers test pool, against a fresh local D1 database, with no network.

### Tests

| Layer | What is tested | How |
| --- | --- | --- |
| Metrics | Every formula, excused blocks, leave days, rescheduled blocks, partials, empty days, the 10-block reward floor | Pure functions over fixture days with hand-calculated expected values |
| Operations | Each op: valid input applies and writes its event in one batch; invalid input changes nothing; undo restores the before state | Fresh local D1 per test |
| Business rules | Capacity overflow warning, max 3 priorities, max 3 weekly outcomes, duplicate-task detection, postpone counter | Unit tests on the ops layer |
| API | Each route's status codes and response shape | Hono `app.request()` in the Workers pool |
| Auth | Requests without a valid Access JWT, or with a wrong audience, get 401; MCP and inbound tokens are limited to their scopes | Signed test tokens |
| Migrations | Fresh install and upgrade from every earlier version reach the same schema | Apply all migrations to empty and seeded databases |
| Backup | Export, restore into a scratch database, row counts and checksums match | Integration test plus the monthly drill |
| Portability | The same op tests pass on the Node and SQLite platform adapter | Second test run in CI |
| Integrations | Signature generation, retries and backoff, duplicate inbound requests ignored | Unit tests with a fake webhook receiver |
| AI | Recorded transcripts map to expected ops; malformed model output never applies | Golden files with a fake provider |
| Front end | Plan a day, submit a block, close the day | A manual checklist per milestone; Playwright only if regressions appear |

### Reliability measures

- **Write first, render second.** Every UI action is a request that commits to D1 before the UI shows success. No state lives only in the browser.
- **Atomic operations:** each op sends its entity changes and its `events` row as one `db.batch()`, which D1 applies all or nothing.
- **Backups** in four layers (section 2): Time Travel, nightly export to R2, weekly laptop pull, and an export before every deploy.
- **Append-only events,** enforced by triggers, provide the audit trail and Undo.
- **Interrupted sessions:** an `active` block survives a browser restart because its state is in the database; the Now card resumes it. Unsent chat text is kept in the browser's local storage.
- **Day close is idempotent,** and runs from a cron trigger at your day-close time if you skip it. Cron runs in UTC, so your time zone is stored in settings and converted.
- **Free-tier guard:** the settings page shows today's D1 reads and writes and warns at 70% of the limit.
- **Failure isolation:** AI and automation calls are caught at their edges; no write path depends on either.
- **Auth on every request:** the Access JWT check runs before any route, and is tested.

### Token benchmark

Reported savings of 80 to 90% come from other workloads and are not assumed here. The benchmark uses your real trial data as its primary source. The synthetic seed is used only until real data exists, and for the tests in the repository. A frozen, versioned evaluation set of about 50 questions with known answers is built from real use, so any loss of information shows up. Real data stays local and out of the repo. Before anything is sent to an external provider, names are replaced with stable placeholders. Metrics are tokens, retrieval accuracy, answer accuracy, latency and estimated cost. The benchmark runs eight real Personal OS workloads (W1 to W8, defined in the companion doc). It compares a naive full-context baseline (B0) and the current context pack (B1) against each optimisation stage. A stage stays only if it cuts tokens by at least 25% with no drop in answer quality on the golden checks. Details are in the [context management doc](https://claude.ai/artifact/ABiouk3JvhpCpsBEdnD6cP).

### Record retention

Meaningful records are kept indefinitely, and nothing meaningful is deleted automatically. Growth is managed by archiving, indexing and summaries. Full policy: section 5a of the [context management doc](https://claude.ai/artifact/ABiouk3JvhpCpsBEdnD6cP).

| Record type | Retention | Where |
| --- | --- | --- |
| Projects, tasks, milestones, time blocks, submissions, decisions, notes, events, reviews | Indefinite | D1 |
| Daily, weekly and monthly logs | Indefinite | Markdown in R2, mirrored to the laptop |
| Summaries and checkpoints | Indefinite (superseded, never overwritten) | D1 |
| AI conversation message bodies | Configurable; default: archived after 90 days, with the id and a one-line summary kept | Body to R2 (or local files), stub in D1 |
| Large AI and tool outputs (artifacts) | Kept; metadata always in D1 | Bodies over 64 KB in R2 |
| Debug and technical logs, webhook delivery records | 30 to 90 days, default 60 | D1, cleaned by the weekly cron |
| Backups | 14 daily, 8 weekly, 12 monthly, with a monthly restore test | R2 and the laptop |

**Manual deletion** is the one deliberate exception to "nothing is hard-deleted". Only you can do it, as a Tier B action. It removes the content, leaves a tombstone event saying what was deleted and when, and is still covered by export and backup restore. Corrections work as before: a new event, with the original preserved.

**Storage guard:** the settings page shows D1 size and alerts at 50% of the free-plan limit, well before archiving would be needed.

## 11. Claude Code implementation handoff

Start each milestone as its own Claude Code session in the repository, with this document saved as `docs/SPEC.md` and the CLAUDE.md below at the root. One milestone per session keeps changes reviewable, and each session ends with tests passing and a short demo checklist.

### CLAUDE.md for the repository

```markdown
# Personal OS: rules for working on this codebase

## What this is
A personal accountability app for one user. It is developed locally with Wrangler and hosted
on Cloudflare's free tier behind Cloudflare Access.
The full spec is docs/SPEC.md. Read the section for the current milestone before coding.

## Stack (do not add to it without asking)
- TypeScript, Cloudflare Workers, Hono, Zod, D1, R2. Wrangler for local dev and deploy.
- Front end: plain HTML, one CSS file, vanilla JS ES modules in public/. No build step,
  no framework.
- Tests: Vitest with @cloudflare/vitest-pool-workers.
- No paid services, and no new dependencies without approval.

## Architecture rules
- All writes go through src/ops/. REST routes, the MCP endpoint, AI chat and inbound
  integrations all call ops; nothing else writes to the database.
- Each op sends its changes plus one events row per entity as a single db.batch().
- Cloudflare-specific code lives only in src/platform/. Everything else uses the Db and
  FileStore interfaces, so the app also runs on Node and SQLite.
- Never hard-delete. Use archived_at or a status. The only exception is the user-only
  manual delete op, which leaves a tombstone event (section 10, Record retention).
- Schema changes only as a new numbered file in migrations/. Never edit an applied migration.
- Metrics live in src/services/metrics.ts as pure functions with no I/O.
- Never commit personal data, .dev.vars, .wrangler/, exports or backups.
- Generated Markdown is output only. Never parse it back into the database.
- The app must work with no AI provider and no automation configured.
- Every request is authenticated: Access JWT for the UI and API, OAuth for MCP,
  scoped tokens for inbound integrations.

## Conventions
- IDs are ULIDs. Timestamps are UTC ISO-8601; calendar-day fields are local YYYY-MM-DD.
- Week = ISO week, Monday start; default planning days Monday to Saturday.

## Working style
- One milestone per session. Finish with: tests green, a list of what to click to verify,
  and anything deferred.
- Ask before adding a dependency, changing the schema outside the milestone, changing a
  metric formula, or touching anything remote (wrangler --remote, deploy, secrets).
```

### Kickoff prompt for M1

```text
Read CLAUDE.md and docs/SPEC.md sections 2, 3 and 4.
Build milestone M1 Foundation, local only (no Cloudflare account needed yet):
- project skeleton as in section 4: package.json, tsconfig, wrangler.jsonc with D1 and R2
  bindings for local dev, .gitignore, .dev.vars.example
- migrations/0001_init.sql from section 3, plus the documents tables
- src/db.ts interfaces and src/platform/cloudflare.ts and node.ts adapters
- src/ops registry with Zod schemas, handlers and risk tiers for: workstreams, objectives,
  projects, milestones, tasks, ideas, decisions, notes, documents; each op writes events in
  one batch; undo by event id
- Hono REST routes for those ops
- JSON and CSV export service
- keep the FTS5 search table in step from the ops layer; give generated Markdown an id: front-matter field
- seed script with the workstreams Business development, Production, Client delivery,
  AI research, Personal admin, their daily targets, and a capacity template of Mon to Sat,
  with Sunday at zero
- Vitest tests for every op, the migrations, and an export round trip; run them on both
  adapters
Stop when tests pass. Do not build any UI, deploy anything, or create Cloudflare resources.
```

### Prompts for later milestones

Use the same shape for every later milestone. Point it at the spec sections it needs (M2: 5; M3: 7; M4: 6 and 7; D: 2; M5 and M6: 2 and 6; A: 12). Paste that milestone's row from the roadmap table as the scope and done-when criteria. End with "Stop when the done-when criteria are met." The D and A milestones touch remote resources, so they run with you present to approve each `wrangler --remote` step.

### Before any code is written

The four decisions are made (see the review section). Next: create the private repository, commit this spec as `docs/SPEC.md` with CLAUDE.md, then run M1.

## 12. Activepieces integration (optional)

Activepieces connects to the Personal OS only through signed outbound webhooks and a scoped inbound API. It moves data and talks to outside services; all rules, scoring and records stay in the Personal OS. It is built in milestone A, after deployment, and the only change in M1 is reserving the `automation` actor value in the events table.

### Division of responsibility

| Personal OS owns | Activepieces owns |
| --- | --- |
| Projects, tasks, schedules, time blocks, submissions, metrics, rewards, reviews | Delivering notifications (email, Telegram, phone push) |
| Every validation and prioritisation rule | Fetching from and posting to outside services (Gmail, Google Calendar, Drive, LinkedIn where its connector allows) |
| Rendering daily and weekly reports | Sending or filing those reports somewhere else |
| Deciding whether an inbound change applies (risk tiers) | Turning outside events into calls to the inbound API |

Rule of thumb: if a flow would need to know how a score is computed or whether a task is a priority, that logic belongs in the Personal OS and the flow should call an endpoint instead.

### Outbound: Personal OS events trigger flows

1. Each op that should be visible to automations writes an `outbox` row in the same `db.batch()` as its change. So an event is never lost, and never sent for a change that failed.
2. After the response is sent, the Worker delivers pending outbox rows to every enabled subscription for that event type (`ctx.waitUntil`).
3. A request carries the JSON envelope `{id, type, version, occurred_at, day, data}`. Its headers are `X-POS-Event-Id`, `X-POS-Timestamp` and `X-POS-Signature`, an HMAC-SHA256 of timestamp and body using that subscription's secret.
4. A 2xx response marks the delivery done. Anything else is retried by a cron run every 10 minutes with backoff: 1 min, 5 min, 30 min, 2 h, 12 h. After the fifth failure the delivery is marked dead and shown on the settings page with a Replay button.
5. Payloads carry ids and summaries, not whole records. A flow that needs more calls the read API with its token.

Activepieces' Catch Webhook trigger currently supports only basic authentication, and HMAC support is [listed as planned](https://feedback.activepieces.com/p/hmac-authentication-for-webhooks). Until it ships, each flow uses basic auth on the trigger plus a first Code step that checks the signature and rejects timestamps older than 5 minutes.

Event catalogue (version 1): `task.created`, `task.completed`, `task.postponed`, `block.started`, `block.submitted`, `block.missed`, `block.ending_soon`, `day.committed`, `day.closed` (with metrics and a link to the Markdown), `week.closed`, `project.created`, `project.status_changed`, `idea.captured`.

### Inbound: flows send updates back

- **Endpoint:** `POST /api/integrations/ops/{op}`. It accepts the same operations and Zod schemas as the UI, so there is no second write path.
- **Authentication, two layers:** a Cloudflare Access service token (`CF-Access-Client-Id` and `CF-Access-Client-Secret`, free) to get past Access. Then a Personal OS integration token (Bearer), stored only as a hash, which names the ops it may call.
- **Risk tiers still apply:** Tier A ops apply at once with actor `automation`. Tier B ops become pending proposals you accept in the app, so a flow cannot change priorities or deadlines by itself.
- **Duplicate protection:** an `Idempotency-Key` header is required. Keys are kept for 7 days, and a repeated key returns the original response without applying anything again. Outbound events carry stable ids for the same reason.
- **Errors:** 4xx for invalid input or missing scope (the flow should not retry), 429 with `Retry-After` when rate-limited (60 requests a minute per token), 5xx for a temporary failure (safe to retry with the same key).

### Suggested first automations

| Flow | Trigger | Action |
| --- | --- | --- |
| Evening summary to phone | `day.closed` | Send the four metrics and unfinished tasks to Telegram or email |
| Weekly report filing | `week.closed` | Save the weekly Markdown to Google Drive and email it to you |
| Block nudge | `block.ending_soon`, `block.missed` | Push a reminder with a link to the submit sheet |
| Client email capture | Gmail label "client" | Inbound `create_task` (unscheduled, Tier A) under Client delivery |
| Calendar capacity | Google Calendar busy events | Inbound `set_day_capacity` as a proposal |
| Quick capture | Form, Telegram bot or email-to-self | Inbound `capture_idea` |
| LinkedIn check | Weekly schedule | Read published posts if the connector allows; inbound `complete_task` for matching distribution tasks |

### Where Activepieces runs

| Option | Fit | Cost | Notes |
| --- | --- | --- | --- |
| Cloudflare Worker | Not possible | n/a | Activepieces is a long-running Node server with PostgreSQL and Redis. Self-hosting guides list [4 containers and 4 GB RAM minimum](https://docs.vultr.com/how-to-deploy-activepieces-open-source-business-automation-platform). Workers can't run it. |
| Cloudflare Containers | Poor | Needs [Workers Paid, $5 a month](https://developers.cloudflare.com/containers/pricing/), and usage would far exceed the included memory hours | Containers sleep when idle, and the database would still need a home. |
| Docker Desktop with WSL2 on the XPS | **Start here** | Free | Runs only while the laptop is on. Check free RAM: the stack wants about 4 GB. |
| Small always-on server (VPS) | Later | Roughly $5 to $10 a month | Needs your approval; also needs updates and backups. |
| Activepieces Cloud | Alternative | Check their current free plan | No server to run; data passes through their service. |

Connectivity with the laptop setup:

- **Activepieces to Personal OS:** plain outbound HTTPS to the Worker with the service token. Nothing to configure.
- **Personal OS to Activepieces:** the Worker can't reach `localhost`. Run `cloudflared` (Cloudflare Tunnel, free) on the laptop to publish only the Activepieces webhook path on a hostname such as `hooks.<your domain>`, protected by Access. While the laptop is off, deliveries fail and are retried for up to about 14 hours, then marked dead for replay, so nothing is lost.
- In local development, both run on the laptop and talk directly.

### Automation settings page

This is a page in the Personal OS. Workflows are still built in the Activepieces editor.

- **Subscriptions:** name, target URL, event types, enabled toggle, secret creation date, Rotate secret, Send test event.
- **Inbound tokens:** name, allowed ops, last used, Revoke.
- **Health:** last successful delivery per subscription, counts of pending and dead deliveries, tunnel reachability.
- **Recent deliveries:** the last 100, with event, status, attempts, response code and error, plus Replay on dead ones.
- **Later, optional:** list flows and recent runs from the Activepieces API, read-only.

### Schema additions (milestone A migration)

```sql
CREATE TABLE webhook_subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  event_types TEXT NOT NULL,          -- JSON array
  secret_ref TEXT NOT NULL,           -- name of a Worker secret, never the value
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, secret_rotated_at TEXT
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,                -- also the event id sent to receivers
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES outbox(id),
  subscription_id TEXT NOT NULL REFERENCES webhook_subscriptions(id),
  status TEXT NOT NULL CHECK (status IN ('pending','done','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT, last_status_code INTEGER, last_error TEXT,
  UNIQUE (outbox_id, subscription_id)
);
CREATE INDEX deliveries_due ON deliveries(status, next_attempt_at);

CREATE TABLE integration_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,    -- SHA-256; the token is shown once
  allowed_ops TEXT NOT NULL,          -- JSON array
  last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE idempotency_keys (
  key TEXT NOT NULL,
  token_id TEXT NOT NULL REFERENCES integration_tokens(id),
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (token_id, key)
);
```

Secrets: webhook signing secrets and the Cloudflare service token are Worker secrets (`wrangler secret put`), and their copies inside Activepieces are kept in its encrypted connections store. None are committed to git. Outbox rows and delivery records older than the debug-log retention (default 60 days) are cleaned by the weekly cron so the free-tier storage and row limits stay untouched.

## 13. Agent delegation and OpenBot (optional, milestone G)

The Personal OS can hand a task to an outside agent environment, track it, and take the result back as a proposal. OpenBot is the first adapter, behind a provider-neutral contract. Full research, SQL and done-when criteria are in [Personal OS: OpenBot and agent delegation](https://claude.ai/artifact/VV2QtMxHANpGaHfukeHm6v). OpenBot's docs were checked on 27 Nov 2026 (v0.80.0).

### What OpenBot offers, as verified

| Area | Finding | Design consequence |
| --- | --- | --- |
| Form | Free Electron desktop app for Windows, macOS and Linux, plus an optional headless Linux server; agents run on providers you already have (Claude Code, Codex, ACP agents, Ollama) | No extra AI cost |
| Inbound trigger | Signed webhook routines: POST `{type, occurredAt, data}` up to 64 KiB, headers `X-OpenBot-Timestamp`, `-Delivery-Id`, `-Signature`, HMAC-SHA256 of `timestamp.deliveryId.body` | Needs its own signing adapter in the outbox, separate from `X-POS-*` |
| Offline host | Returns 503 and does not queue | The milestone A outbox retries cover it |
| Results | No public REST API, outbound webhooks or task CLI | Agents report back by calling the Personal OS: MCP tools, or `POST /api/agents/reports` with a token scoped to one assignment |
| Permissions | Defaults to full access with no approvals after first consent | Set agents to Workspace only or Ask first |
| Windows | Native desktop app supported; WSL not documented; headless server tested only on Ubuntu 24.04 | Run the desktop app on Windows |
| Remote access | Through an OpenBot account and a WebRTC relay, no inbound ports | No tunnel needed for OpenBot itself |
| Licence | PolyForm Noncommercial | Using it for paid client work may need a commercial licence. Check before using it for Client delivery |

### How delegation works

1. You mark a task Delegate and choose a provider (manual or OpenBot). The dispatch itself needs your approval.
2. An `agent_assignments` row is created, and an `agent.dispatched` outbox event goes to the provider adapter.
3. The agent works in its own workspace. It can read context through MCP, but cannot write directly.
4. Progress and the final report arrive through `agent_reports`, with outputs stored in `agent_artifacts` (large bodies in R2).
5. Any change the report implies (task done, follow-ups, a decision) becomes a Tier B proposal for you to accept. The time spent is not counted as your focused time.

Activepieces can sit in between for event-driven delegation and follow-ups, using the same outbox events.

### Phase 1 impact

The only M1 change is reserving the `agent` actor value in `events`, which is already in the schema. The tables `agent_providers`, `agent_assignments`, `agent_reports` and `agent_artifacts` arrive in milestone G's migration.
