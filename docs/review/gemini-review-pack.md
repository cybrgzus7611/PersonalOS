# Personal OS: independent review pack for Gemini

Prepared 27 Nov 2026 by Claude Code. One self-contained file: paste it whole into Gemini (or upload it) and send it as is.
It contains no personal data: no real tasks, notes, contacts or account details, only the design.

---

## Part 0. Instructions for the reviewer (Gemini, read this first)

You are an independent senior reviewer. Several AI coding environments build this app together, and you are the one that
did not write any of it. Your job is to find what the authors missed, not to restate the design.

1. Read Parts 1 to 4. They are the authoritative design, the working rules, and the API contract for the current milestone.
2. Answer every question in Part 5, in the format in Part 6.
3. Be specific: quote the section or field you mean, say what breaks, for whom, and how you would change it.
4. Rank by severity. A few well-argued problems beat many shallow ones. Say "no issue found" when that is your honest answer.
5. Respect the constraints in Part 2 (free tier only, no build step, no framework, no new dependencies without approval,
   one user). A suggestion that breaks one must say so and justify the cost.
6. Do not rewrite the spec or produce code longer than 20 lines. If something is ambiguous, list it as a question instead of guessing.

---

## Part 1. What the project is and where it stands

**Personal OS** is a single-user personal accountability app: plan the week in a swimlane of five workstreams, commit each
day's plan, time-block the day, submit every block honestly (completed, partial, diverted, missed), and see transparent
metrics (execution, adherence, focus) and a weekly review. An AI "chief of staff" comes later (milestone M5) and may only
change data through the same typed operations as the UI. The app must remain fully usable with no AI and no automation.

- Stack: TypeScript on one Cloudflare Worker (Hono, Zod), D1 (SQLite), R2, static assets; developed locally with Wrangler;
  later hosted on Cloudflare's free tier behind Cloudflare Access. Also runs on Node with node:sqlite (portability).
- Front end: plain HTML, one CSS file, vanilla ES modules, no build step.
- Status: **M1 Foundation is done** (schema, ops registry with 50 ops, events log with undo, search, export/import,
  seed; 35 tests on both Node and the Workers runtime; CI green). **M2 Today and Week** is in progress: the backend
  endpoints in Part 4 (section 4) are being built now by Claude Code, and the frontend (OpenCode with GLM) starts once they merge.
- Workflow: Claude (planning) writes specs, Gemini (you) reviews, Claude Code builds the backend, OpenCode builds the
  frontend, then an integration review. Ownership rules are in Part 2.

---

## Part 2. Working rules (CLAUDE.md and AGENTS.md, verbatim)

### CLAUDE.md


#### What this is
A personal accountability app for one user. It is developed locally with Wrangler and hosted
on Cloudflare's free tier behind Cloudflare Access.
The full spec is docs/SPEC.md. Read the section for the current milestone before coding.

#### Stack (do not add to it without asking)
- TypeScript, Cloudflare Workers, Hono, Zod, D1, R2. Wrangler for local dev and deploy.
- Front end: plain HTML, one CSS file, vanilla JS ES modules in public/. No build step,
  no framework.
- Tests: Vitest. Node project (node:sqlite adapter) plus a Workers project using
  @cloudflare/vitest-plugin (local D1). Both run the same shared suites.
- No paid services, and no new dependencies without approval.

#### Architecture rules
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

#### Conventions
- IDs are ULIDs. Timestamps are UTC ISO-8601; calendar-day fields are local YYYY-MM-DD.
- Week = ISO week, Monday start; default planning days Monday to Saturday.

#### Multi-environment workflow
- Several AI coding environments work on this repo. Ownership by folder and branch is in
  AGENTS.md. Claude Code owns the backend (src/, migrations/, test/ except test/frontend/,
  scripts/, config and CI) and does not edit public/ (frontend, owned by OpenCode).
- Backend branches are named be/<topic>. Frontend needs are recorded in docs/handoff/.

#### Working style
- One milestone per session. Finish with: tests green, a list of what to click to verify,
  and anything deferred.
- Ask before adding a dependency, changing the schema outside the milestone, changing a
  metric formula, or touching anything remote (wrangler --remote, deploy, secrets).

### AGENTS.md


This file is read by every coding agent (OpenCode, Claude Code and others). `CLAUDE.md` holds the
architecture rules; they apply to everyone. This file adds who owns what, so separate environments
never overwrite each other.

#### Roles

| Environment | Role | Owns (may change) |
| --- | --- | --- |
| Claude (planning, Opus) | Architecture, specs, technical decisions | `docs/SPEC.md`, `docs/handoff/*` (except checklists below), `CLAUDE.md`, `AGENTS.md` |
| Gemini | Independent review of plans and specs | Nothing in the repo; reviews go in PR comments or the project chat |
| Claude Code | Backend, database, API, tests, CI | `src/`, `migrations/`, `test/` (except `test/frontend/`), `scripts/`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.github/` |
| OpenCode + GLM | Frontend | `public/`, `test/frontend/`, `docs/handoff/M*-checklist.md` |
| OpenCode + DeepSeek | Alternative model for frontend tasks, comparison and debugging | Same folders as OpenCode + GLM, on its own `fe/<topic>-ds` branch |
| Integration review | Claude Code, then the owner | Reviews only; fixes go back to the owning environment |

If a change is needed outside your area, **do not make it**. Write it down in your PR description
under "Needs from other environments" (for example a missing endpoint) and stop that part of the work.

#### Branches and pull requests

- `main` is protected by convention: every change arrives through a pull request with CI green.
- Branch names show the owner: `be/<topic>` (Claude Code), `fe/<topic>` (OpenCode), `docs/<topic>` (planning).
- One environment per branch. Never push to another environment's branch. DeepSeek works on
  `fe/<topic>-ds`, branched from the GLM branch; its changes reach `fe/<topic>` only through a PR.
- Start every branch from the latest `main`. Before opening the PR, merge the latest `main` into your
  branch (do not rebase a branch someone else may have pulled).
- PR title starts with the milestone, e.g. `M2 frontend: Today and Week views`. The description states
  which environment and model wrote it.
- Backend changes that the frontend depends on merge first. The frontend never works around a missing
  endpoint by writing to the database or adding server code.

#### Rules every environment follows

- The API contract is `docs/handoff/M2-frontend.md` sections 3 and 4 (and later handoffs). If code and
  contract disagree, stop and report it; do not change one to match the other on your own.
- The frontend changes data only through `POST /api/ops/<name>`, from `public/js/api.js` only.
- No new dependencies (npm or browser) without the owner's approval. No CDNs, external fonts or analytics.
- Never commit personal data, `.dev.vars`, `.wrangler/`, exports or backups.
- Run `npm run check` before every push. It must pass. It includes `check:public`, which blocks `fetch(`
  outside `public/js/api.js`, HTML built from strings, other-origin URLs and inline scripts or handlers.
- Do not reformat or "tidy" files you do not own; it creates conflicts for the owner.

---

## Part 3. Product and architecture spec (essentials of docs/SPEC.md)

The full spec is about 1,100 lines. Included here: the critical review and decisions, product requirements, stack and architecture, the schema, the screen spec, the operation tiers, the time-block accountability spec, the roadmap and the testing strategy. Left out: folder structure, the AI context strategy, the M1 kickoff prompt, and the optional Activepieces (automation) and OpenBot (agent delegation) sections, which are later milestones A and G.

### Summary and critical review

Build it as a small TypeScript app on one Cloudflare Worker over D1 (hosted SQLite), developed locally first and deployed to the free tier, with a no-build vanilla JS front end and the AI behind a strict list of typed operations. Ship the accountability loop (plan, time-block, submit, score) before any AI, and keep Markdown as a readable output rather than a second database. The vision holds up. The gaps below are the things most likely to make the system fail in daily use, ordered by risk.

#### What is missing from the spec

1. **Capacity has no source.** Rule 1 (protect capacity) needs to know how many hours you actually have each day. Add a weekly capacity template (working hours per weekday) plus per-day overrides for client days, appointments and days off.
2. **No "committed plan" moment.** Schedule adherence compares against "the schedule I originally committed to", but nothing defines when a plan becomes committed. Add an explicit Commit step in the morning briefing that freezes a snapshot. Changes after that are reschedules, which is what makes adherence measurable.
3. **Unsubmitted blocks.** The status list has no answer for a block you simply never submitted. Add a `missed` status, set automatically at day close, so forgotten blocks count against adherence instead of disappearing.
4. **Days off and sick days.** A day marked as leave must be excluded from scores. Otherwise Rule 10 (do not punish legitimate changes) breaks on day one.
5. **Day and week boundaries.** Define the week as Monday to Sunday, the day by local date, and a configurable day-close time (for example 04:00) so working past midnight still lands on the right day.
6. **Capture away from the desk.** Ideas arrive on your phone. A localhost-only app cannot receive them. MVP: none. Later: reach the app over your home network or a private tunnel such as Tailscale.
7. **What counts as output.** Rule 6 needs tasks to carry a deliverable flag (a published post, a finished template, a delivered client file). Without it, the output metric has nothing to count.
8. **Rollover mechanics.** Rule 4 says no automatic rollover but not what happens instead. Specify a forced triage at evening review: each unfinished task goes to tomorrow, later this week, backlog or dropped, and a postpone counter is shown after the second move.

#### Weaknesses and challenged assumptions

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

#### Decisions from the owner (27 Nov 2026)

- **Machine and hosting:** develop and trial on the existing existing Windows 10 laptop, using Node LTS and Wrangler natively on Windows. Once the MVP has been trialled, deploy to Cloudflare's free tier (Workers, D1, R2, Access). The code stays portable to plain Node and SQLite. This replaces the earlier Python and FastAPI recommendation, because Workers run TypeScript natively and Python Workers are a poor fit for the free plan's CPU limit.
- **Week:** Monday to Saturday is the default planning week. Sunday has zero capacity in the template, and work planned there counts only if you commit it. Weeks still start on Monday.
- **AI path:** free first, through a remote MCP endpoint used from Claude on your Pro plan. A local model through Ollama only works in local mode or through a tunnel, and this laptop's 2 GB GPU limits it to small models. Paid API adapters stay in the design, switched off.
- **Automation:** Activepieces is optional and is integrated after the core is deployed (section 12).
- **Repository:** a private GitHub repository holding code only. Git is used from the first commit.
- **Paid services:** none without your approval.
- **Still open:** whether to import the old Google Forms history.

### 1. Product requirements

The product succeeds if the owner opens it every working morning, submits most time blocks the same day, and can see each Friday whether core work beat exploratory work. Everything else serves that loop.

#### Users and context

One user. Developed and trialled locally on the laptop, then hosted on Cloudflare's free tier behind a login. No sharing and no other users.

#### Success measures (after 4 weeks of use)

| Measure | Target |
| --- | --- |
| Working days with a committed morning plan | 80% or more |
| Time blocks submitted on the day | 85% or more |
| Median time to submit a block | under 15 seconds |
| Time spent on admin in the app per day | under 10 minutes |
| Weekly review completed | every week |

#### Core loop

1. **Morning (5 min):** see yesterday's leftovers and this week's three outcomes, pick at most three priorities, lay out time blocks within today's capacity, press Commit.
2. **During the day:** start a block, work, submit it with a status, minutes and an optional note. Capture anything else in one line.
3. **Evening (5 min):** triage unfinished tasks, see today's four metrics, close the day. The daily log is written.
4. **Friday or Sunday:** weekly review shows planned against actual per workstream, neglected projects, distraction patterns and the reward result, then sets next week's three outcomes.

#### Functional requirements

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

#### Non-functional requirements

- Works fully with the AI and automations switched off. The hosted version needs internet; local mode works offline.
- Every user action persists to SQLite before the UI confirms it.
- Page load under 1 second, any action under 200 ms on the local machine.
- No third-party calls except to the chosen AI provider and any automation webhooks you enable.
- Personal data lives only in D1, R2 and your local backups, never in the repository.

#### Out of scope

Multi-user, mobile app, client billing, invoicing, file storage, email or calendar sending, and any gamification beyond scores and food rewards.

### 2. Stack and architecture

Recommended stack (revised 27 Nov for Cloudflare hosting): TypeScript on a single Cloudflare Worker using the Hono router. D1 (Cloudflare's hosted SQLite) holds the data, R2 holds backups and generated Markdown, and the plain HTML, CSS and JavaScript front end is served as the Worker's static assets. Local development runs the same code on your laptop with Wrangler, which simulates D1 and R2. There is no front-end framework, no UI build step and no Docker.

_Architecture diagram: see the living spec._

The browser, Claude through MCP, the optional embedded AI, and Activepieces (section 12) all reach data only through the operations layer, so validation and the audit trail cannot be bypassed. Cloudflare Access sits in front of every entry point.

#### Stack choices

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

#### How the AI changes data safely

The AI never touches SQL or files directly. It can only call a fixed list of typed operations, the same ones the REST API uses.

1. The backend builds a context pack for the current mode and sends it with the user's message and the operation list as tools.
2. The model replies with text plus zero or more proposed operations, for example `complete_task`, `create_task`, `log_decision`.
3. Each operation is validated: schema (Zod), references exist, business rules hold (capacity, at most three priorities, no duplicate task), and its risk tier is looked up.
4. Tier A operations (record completion, record a submission, add a note, capture an idea) apply at once and show as a dismissible card with Undo.
5. Tier B operations (new project, change priority, move a deadline, archive, change more than two blocks in a committed plan) wait as a proposal card with Accept, Edit and Reject.
6. Every applied operation writes an `events` row with actor `ai`, the proposal id, and before and after values, which is what makes Undo and the audit trail work.
7. Invalid operations are returned to the model once with the error so it can correct itself; a second failure is shown to the user as text, never applied.

If the provider is down, the chat panel says so and everything else keeps working, because the UI never depends on the AI for any write.

#### Free AI path: remote MCP

The Worker also serves the operation list as a remote MCP endpoint. A custom connector in Claude can reach it from Claude Desktop, the web or the phone app, so it uses your Pro plan with no API credits, and it gives you phone capture as a bonus (check custom-connector availability in your Claude settings). The endpoint needs its own OAuth login, which Cloudflare's open-source `workers-oauth-provider` library handles. The embedded chat, using a paid API key or a local model, stays optional and can be added at any time.

#### Cloudflare free tier: evaluation

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

#### Portability and lock-in

All Cloudflare-specific code lives in one folder, `src/platform/`. Everything else talks to two small interfaces, `Db` and `FileStore`.

| Cloudflare piece | Portable replacement, same app code |
| --- | --- |
| Workers + Hono | Hono on Node (`@hono/node-server`) on any machine |
| D1 | A plain SQLite file through Node's built-in `node:sqlite` |
| R2 | Any S3-compatible store, or a local folder |
| Access | Any auth proxy (for example Tailscale), or a built-in passkey login |
| Cron Triggers | The operating system's scheduler calling the same endpoint |

Exit procedure: `wrangler d1 export` produces a SQL file, which loads into SQLite. Then start the Node build.

#### Security and authentication

1. **Cloudflare Access** protects the app's hostname. The `workers.dev` and preview URLs are turned off so nothing bypasses it. The policy allows only your email address, with login by one-time email code or GitHub. Sessions last 7 days on your own devices.
2. **The Worker checks the Access JWT** (`Cf-Access-Jwt-Assertion` header) on every request: the signature against your team's keys, plus the audience tag. A misconfigured route therefore still cannot expose data.
3. **The MCP endpoint** uses its own OAuth flow with revocable tokens, and can only call the same validated operations.
4. **Secrets** (API keys, OAuth signing keys) are set with `wrangler secret put` and never committed. Local secrets go in `.dev.vars`, which is git-ignored.
5. **Headers:** a strict Content Security Policy (own origin only, no third-party scripts), HSTS, and `X-Content-Type-Options`.
6. **Accounts:** two-factor authentication on Cloudflare and GitHub. The deploy API token is limited to this Worker, its D1 database and its R2 bucket. The repository is private, with GitHub secret scanning on.

#### Backup, restore and export procedures

| Layer | What | When | Kept | Restore |
| --- | --- | --- | --- | --- |
| D1 Time Travel | Point-in-time copy of the database | Continuous, automatic | 7 days | `wrangler d1 time-travel restore` to a timestamp |
| Nightly export | GitHub Actions runs `wrangler d1 export --remote` and uploads the SQL file to R2 | Daily, 03:00 | 14 daily, 8 weekly, 12 monthly | Load the file into a new D1 database, then switch the binding |
| Off-Cloudflare copy | `npm run backup:pull` downloads the latest export and the Markdown from R2 to your laptop | Weekly, prompted during the weekly review | All | Same, or open the SQL file locally |
| Pre-deploy | An export runs before every remote migration | Every deploy | Last 10 | Same |

The nightly export runs in GitHub Actions, not a Worker cron job. A full dump could pass the 10 ms CPU limit as the data grows, and Actions minutes on a private repository are free up to a monthly allowance. Once a month, run a restore drill: load the latest export into a scratch database and compare row counts. Before deploying, re-check Cloudflare's current D1 and R2 free-tier limits.

**Export for you:** the Review screen offers JSON (all tables) and CSV per table, fetched page by page to stay within CPU limits. Rendered daily, weekly and monthly Markdown is always downloadable from R2.

#### Deployment procedure

1. Run `npm test` locally. It must pass.
2. Push to the private GitHub repository. CI runs the tests again.
3. Run `npm run deploy`, which exports a backup, applies pending migrations with `wrangler d1 migrations apply --remote`, then runs `wrangler deploy`.

Deploy from the laptop at first. Automatic deploys from GitHub can come later, if they're ever wanted.

### 3. SQLite schema

**The applied migrations in `migrations/` are the authoritative schema.** The block below is a verbatim copy of `0001_init.sql`, `0002_weekly_outcome_archive.sql` and `0003_events_undo_once.sql`; refresh it whenever a migration is added (the Gemini review of 27 Nov found the earlier hand-written sketch had drifted from the code). All tables are keyed by ULID text ids (sortable by creation time), with UTC ISO-8601 timestamps plus a separate local `day` column wherever a record belongs to a calendar day. `PRAGMA foreign_keys=ON` is set for local SQLite (D1 enforces foreign keys by default). Domain records are never hard-deleted: they carry `archived_at` or a status, and every change writes an `events` row. `projects.last_activity_at` is maintained by the ops layer, not by triggers; the only triggers protect `events`.

```sql
-- Personal OS schema v1 (docs/SPEC.md section 3).
-- Conventions: ULID text ids; UTC ISO-8601 timestamps (`*_at`); local calendar days (`day`, `*_day`) as YYYY-MM-DD.
-- Nothing is hard-deleted: rows carry archived_at or a terminal status. Every change writes an events row.

-- Configuration ------------------------------------------------------
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL                      -- JSON
);

CREATE TABLE workstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  colour TEXT NOT NULL,
  daily_target_min INTEGER NOT NULL DEFAULT 0 CHECK (daily_target_min >= 0),
  is_core INTEGER NOT NULL DEFAULT 0 CHECK (is_core IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE capacity_template (
  weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Monday
  available_min INTEGER NOT NULL CHECK (available_min BETWEEN 0 AND 1440),
  start_time TEXT,
  end_time TEXT
);

CREATE TABLE days (
  day TEXT PRIMARY KEY,
  available_min INTEGER NOT NULL CHECK (available_min BETWEEN 0 AND 1440),
  day_type TEXT NOT NULL DEFAULT 'work' CHECK (day_type IN ('work','leave','sick','light')),
  committed_at TEXT,
  plan_snapshot TEXT,
  closed_at TEXT
);

-- Strategy -----------------------------------------------------------
CREATE TABLE objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  horizon TEXT CHECK (horizon IN ('quarter','year','multi_year')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','dropped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  objective_id TEXT REFERENCES objectives(id),
  workstream_id TEXT NOT NULL REFERENCES workstreams(id),
  client_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','blocked','done','abandoned')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  due_day TEXT,
  health_note TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX projects_status ON projects(status, priority);

CREATE TABLE milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  due_day TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX milestones_project ON milestones(project_id);

CREATE TABLE weekly_outcomes (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,                      -- ISO week, e.g. 2026-W48
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
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','dropped','backlog')),
  estimate_min INTEGER CHECK (estimate_min IS NULL OR estimate_min > 0),
  planned_day TEXT,
  due_day TEXT,
  is_deliverable INTEGER NOT NULL DEFAULT 0 CHECK (is_deliverable IN (0, 1)),
  is_priority INTEGER NOT NULL DEFAULT 0 CHECK (is_priority IN (0, 1)),
  postpone_count INTEGER NOT NULL DEFAULT 0,
  parent_task_id TEXT REFERENCES tasks(id),
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','quick_add','automation','agent')),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX tasks_day ON tasks(planned_day, workstream_id);
CREATE INDEX tasks_project ON tasks(project_id, status);
CREATE INDEX tasks_status ON tasks(status);

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
  task_id TEXT REFERENCES tasks(id),
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  sched_start TEXT NOT NULL,
  sched_end TEXT NOT NULL,
  planned_min INTEGER NOT NULL CHECK (planned_min > 0),
  in_commit INTEGER NOT NULL DEFAULT 0 CHECK (in_commit IN (0, 1)),
  rescheduled_from_id TEXT REFERENCES time_blocks(id),
  state TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned','active','submitted','rescheduled','missed','cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX blocks_day ON time_blocks(day);

CREATE TABLE block_submissions (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL UNIQUE REFERENCES time_blocks(id),
  status TEXT NOT NULL CHECK (status IN ('completed','partial','diverted','interrupted','rescheduled','skipped','missed')),
  actual_start TEXT,
  actual_end TEXT,
  focused_min INTEGER NOT NULL DEFAULT 0 CHECK (focused_min >= 0),
  interruption_kind TEXT CHECK (interruption_kind IN ('client','urgent','technical','personal','other')),
  diverted_to TEXT,
  notes TEXT,
  submitted_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','ai','system','automation'))
);

-- Memory -------------------------------------------------------------
CREATE TABLE ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT,
  kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea','possible_project','opportunity')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','promoted','parked','dropped')),
  promoted_to_type TEXT,
  promoted_to_id TEXT,
  mention_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  title TEXT NOT NULL,
  rationale TEXT,
  supersedes_id TEXT REFERENCES decisions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('blocker','observation','accomplishment','priority_change')),
  project_id TEXT REFERENCES projects(id),
  body TEXT NOT NULL,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

-- Authored Markdown memory (brain files, project narratives) with full version history.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,               -- e.g. brain/MASTER_CONTEXT.md
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'user',
  archived_at TEXT
);

CREATE TABLE document_versions (
  document_id TEXT NOT NULL REFERENCES documents(id),
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, version)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  period_type TEXT NOT NULL CHECK (period_type IN ('day','week','month')),
  period TEXT NOT NULL,
  metrics TEXT NOT NULL,
  narrative TEXT,
  recommendations TEXT,
  reward TEXT,
  markdown_path TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (period_type, period)
);

-- History and AI -----------------------------------------------------
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('morning','running','evening','weekly','admin')),
  day TEXT NOT NULL,
  provider TEXT,
  model TEXT,
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
  args TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('A','B')),
  status TEXT NOT NULL CHECK (status IN ('applied','pending','accepted','rejected','invalid','undone')),
  explanation TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- Append-only activity log and audit trail.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user','ai','automation','agent','system')),
  op TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  proposal_id TEXT REFERENCES ai_proposals(id),
  undone_by TEXT REFERENCES events(id)
);
CREATE INDEX events_day ON events(day);
CREATE INDEX events_entity ON events(entity_type, entity_id);

CREATE TRIGGER events_no_update BEFORE UPDATE OF id, at, day, actor, op, entity_type, entity_id, before_json, after_json ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are append-only');
END;

-- Full-text search over tasks, projects, ideas, decisions, notes and documents (kept in step by src/ops).
CREATE VIRTUAL TABLE search USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, day UNINDEXED, body);

-- M2: weekly outcomes can be cleared without a hard delete (CLAUDE.md: never hard-delete).
-- Rebuilds weekly_outcomes with archived_at; only one active outcome per week and position.
-- Nothing references weekly_outcomes, so the table can be dropped and recreated safely.
CREATE TABLE weekly_outcomes_new (
  id TEXT PRIMARY KEY,
  week TEXT NOT NULL,                      -- ISO week, e.g. 2026-W48
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','partly','missed')),
  archived_at TEXT
);
INSERT INTO weekly_outcomes_new (id, week, position, title, project_id, status)
  SELECT id, week, position, title, project_id, status FROM weekly_outcomes;
DROP TABLE weekly_outcomes;
ALTER TABLE weekly_outcomes_new RENAME TO weekly_outcomes;
CREATE UNIQUE INDEX weekly_outcomes_slot ON weekly_outcomes(week, position) WHERE archived_at IS NULL;

-- Review hardening: an event can be marked undone once, and that mark never changes or clears.
-- (0001 already makes every other events column immutable and forbids deletes.)
CREATE TRIGGER events_undone_once BEFORE UPDATE OF undone_by ON events
WHEN OLD.undone_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'an undone event stays undone');
END;
```

#### Design notes

- **Objective to daily action** is `objectives` to `projects` to `milestones` to `tasks` to `time_blocks` to `block_submissions`. Milestone and project are optional on a task, so quick capture never forces a choice.
- **History vs current state:** current state lives in the entity tables; history lives in `events`, `block_submissions`, `decisions`, `notes` and `reviews`. Decisions are never edited, only superseded.
- **Rescheduling** creates a new block with `rescheduled_from_id` and marks the old one `rescheduled`, so the original committed plan is never rewritten.
- **Reviews in one table** with `period_type` replaces separate daily and weekly tables; the metrics JSON is a frozen snapshot, so later edits do not silently change past weeks.
- **The reward and score formulas** live in `settings` so they can change without migrations; each review stores the weights it was computed with.

#### Later migrations for context management

Four tables arrive with the AI milestones, not in M1. The DDL is in section 5 of the context management doc (a companion doc, not included).

| Table | Milestone | Purpose |
| --- | --- | --- |
| `artifacts` | M5 | Large tool outputs kept whole, deduplicated by hash, body inline or in R2 |
| `context_packs` | M5 | What each pack contained and its token count, for benchmarks |
| `checkpoints` | M5 | Session state of at most 2 KB per mode, for `resume(mode)` |
| `summaries` | M6 | Master, objective, project and milestone summaries, marked stale when newer events exist |

M1 already lays the foundations: ULIDs, the append-only events, the FTS5 `search` table and frozen reviews. Two small additions are in the M1 prompt: keep `search` filled from the ops layer, and put an `id:` field in the front matter of generated Markdown.

### 5. Screen and layout spec

One page, four views (Today, Week, Projects, Review) under a persistent top bar, with the chat as a collapsible right rail. The current or next time block is always visible, because that is where accountability happens.

_Today view wireframe: see the living spec._

The Week, Projects and Review views replace the main area; the top bar and chat rail stay put.

#### Persistent elements

- **Top bar:** date and ISO week; the Now card (current block, workstream colour, elapsed time, Submit button) or the Next card if nothing is active; today's four metric chips; reward progress for the week; quick-add field (shortcut `/` or Ctrl+K).
- **Chat rail (360 px, collapsible):** mode switch (Morning, Running, Evening, Weekly), message history, proposal cards with Accept, Edit, Reject, and applied-change cards with Undo. Hidden entirely when no AI is configured.
- **Toasts:** every write shows a short confirmation with Undo for 10 seconds.

#### Today view

| Region | Contents |
| --- | --- |
| Header strip | Three priorities (checkbox each), plan state: Draft, Committed, Closed |
| Left column, 60% | Vertical timeline of today's blocks in scheduled order; each shows title, workstream colour, planned minutes, status chip. Clicking opens the submit sheet. Free capacity shown as dashed gaps. |
| Right column, 40% | Tasks for today grouped by workstream with checkboxes; unscheduled tasks under each group; capacity bar (planned minutes vs available). |
| Footer actions | Commit plan (morning), Close day (evening, opens triage). |

#### Week view: the swimlane

| Element | Behaviour |
| --- | --- |
| Rows | Workstreams in `sort_order`, core workstreams marked |
| Columns | Monday to Sunday (the Sunday column is narrow unless it holds work) |
| Cards | Task title, estimate, project tag, status tick; `↻2` badge when postponed twice or more |
| Day header | Planned minutes / available minutes; turns amber over 90% and red over 100% |
| Row footer | Planned hours vs the workstream's weekly target, so allocation drift is visible |
| Top strip | The three weekly outcomes with status |
| Interaction | Drag a card to another day or lane; drop on Backlog to unschedule; double-click empty cell to add |

#### Projects view

A register table (title, workstream, status, priority, next milestone, open tasks, health, last activity), sorted by priority then last activity. Stale projects (no activity in 14 days while active) are flagged. Clicking a row opens a side drawer with objective, milestones, task list, decisions, recent events, and the project's Markdown narrative.

#### Review view

Day and Week tabs. Each shows the four metrics as separate tiles with the counts behind them, a planned-versus-actual bar per workstream, a list of diverted blocks with their notes, outputs produced, and the reward result with its formula. Every number links to the blocks it was computed from.

#### Submit sheet (the most-used control)

A bottom sheet with six large status buttons, a focused-minutes field pre-filled with the planned minutes (or the elapsed minutes if the block was started), an optional one-line note, and Submit. Diverted asks "to what?" with workstream chips. Interrupted asks for the kind. Keyboard: 1 to 6 for status, Enter to submit. Target: three clicks and under 15 seconds.

#### Visual style

Dark background (near-black blue-grey), one accent colour, workstream colours used only as thin left borders and tags. Inter or system UI font, tabular numbers for metrics. No gradients, no badges, no confetti. Motion limited to 150 ms transitions. Layout works from 1280 px wide; below 900 px the chat rail becomes an overlay.

#### Operation list and risk tiers

| Tier A: applied at once, undoable | Tier B: needs confirmation |
| --- | --- |
| `complete_task`, `submit_block`, `set_focused_minutes` | `create_project`, `archive_project`, `set_project_status` |
| `add_note` (observation, blocker, accomplishment) | `set_priority`, `set_weekly_outcome` |
| `capture_idea`, `bump_idea_mention` | `move_deadline`, `create_milestone` |
| `create_task` when unscheduled and not a deliverable | `create_task` when scheduled, deliverable, or with a deadline |
| `log_decision` on an existing project | `schedule_blocks` / `move_block` after commit (more than 2 blocks) |
| `link_follow_up` | `propose_brain_edit` (diff to a brain file) |
| read-only: `search_history`, `get_project`, `get_day` | `promote_idea` |

### 7. Time-block accountability spec

A block is planned, optionally started, and always ends with exactly one submission, either from you or as `missed` at day close. All four metrics are computed from those submissions against the committed plan snapshot, never from what the plan looks like later.

#### Block lifecycle

| State | Set by | Next states |
| --- | --- | --- |
| `planned` | creating the block | `active`, `submitted`, `rescheduled`, `cancelled` |
| `active` | Start button (records `actual_start`) | `submitted` |
| `submitted` | Submit sheet or an AI `submit_block` | (edits allowed; each edit logged in `events`) |
| `rescheduled` | moving a committed block; a new block is created with `rescheduled_from_id` | none |
| `cancelled` | deleting a block before commit | none |
| `missed` | day close, when no submission exists | a late submission is still allowed and logged |

#### Submission statuses

| Status | Meaning | Counts against you? |
| --- | --- | --- |
| Completed | Did the planned work | No |
| Partial | Worked on it, not finished | Partly |
| Diverted | Self-directed switch to something else; asks what | Yes |
| Interrupted | External cause; asks kind: client, urgent, technical, personal, other | Client and urgent are excused; others count |
| Rescheduled | Moved before starting | Adherence only |
| Skipped | Chose not to do it | Yes |
| Missed | No submission by day close | Yes |

#### Submission data flow

Using the spec's example (completed, 40 focused minutes, note about the screen-recording animation):

1. Submit sheet posts `{block_id, status: completed, focused_min: 40, notes}` to `POST /api/blocks/{id}/submit`.
2. In one transaction: insert `block_submissions`, set block state `submitted`, set `actual_end` to now, update the linked task (completed marks it `done` unless you untick "task finished"), update `projects.last_activity_at`, write an `events` row.
3. The UI updates the Now card, timeline and metric chips from the response; no reload.
4. If the note contains follow-up language and AI is on, the backend asks the model for a follow-up: it searches open tasks in the same project for a near match (title similarity over 0.8 means link, not create) and returns either `link_follow_up` (Tier A) or `create_task` with `parent_task_id` set. Without AI, the sheet has a "Needs another session" tick that creates the follow-up task directly.
5. The submission appears in today's events and therefore in the daily log at close.

Planned minutes, elapsed minutes (`actual_end` minus `actual_start`) and focused minutes are stored separately and never inferred from each other.

#### Metric definitions

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

#### Weekly report table

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

#### Timing modes

MVP: manual Start and Submit, with elapsed time shown on the Now card. Later: countdown with a browser notification at block end, and a reminder if a block's end passes 10 minutes without a submission. Both use the free browser Notification API.

### 8. MVP roadmap

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

#### Review backlog (independent Gemini review, 27 Nov 2026)

These findings were accepted for later milestones. The M2 items were fixed in the M2-API PR. Items marked **(owner)** wait on a decision.

| Milestone | Item | Source |
| --- | --- | --- |
| M3 | Add `actual_start` to `time_blocks` (set on Start, so an active block survives a reload); copy it into `block_submissions` at submit | Gemini #3 |
| M3 | `CHECK (sched_end > sched_start)` on `time_blocks`; indexes `time_blocks(task_id)`, `notes(day)` | #9 |
| M3 | Rewrite the SPEC 7 metric definitions before coding them **(owner: metric formulas)**: Execution without the non-existent `partial`/`excused` task states; Focus capped at 100% and defined for unstarted blocks; Adherence when Start is skipped; Composite re-normalised when a part is null; weekly metrics pool raw counts | #4, Q2 |
| M3 | Commit snapshot v2 for time blocks (`in_commit`), with versioned `plan_snapshot`; tasks added after commit flagged; `done_at` checked against the day-close boundary | #8, Q3 |
| M3 | Cascade rule after an excused interruption: one "Shift remaining blocks" action whose reschedules count as excused **(owner)** | #4, owner Q2 |
| M3 | "Park overdue tasks in the backlog" recovery after days away; `localStorage` drafts for submit notes and reviews; DST and time-zone travel tests for blocks and day close | #14 |
| M3 | One-click "Pack today's tasks into blocks" to avoid double entry | Q1 |
| M4 | Indexes `tasks(is_deliverable, done_at)`, `milestones(project_id)`, `decisions(project_id)` | #9 |
| M4 | Pair the reward's 10-block floor with a minimum committed-hours threshold **(owner: metric formulas)** | Q2 |
| D | Access bypass only for `/mcp`, `/.well-known/*`, `/oauth/*`, `/api/inbound/*`, each enforced in the Worker; fail closed when Access settings are missing outside local mode; day close only from `scheduled()` | #7, Q12 |
| D | Paged export endpoints (cursor chunks) so large exports stay under the 10 ms CPU limit; full restore stays CLI-only | #12 |
| D | D1 gauge from `meta.size_after` only; label any read/write totals as estimates | #12 |
| D | Separate least-privilege token for the nightly backup (D1 export and R2 put only); R2 lifecycle rules for retention; restore drill covers R2 files too; optional `age` encryption of dumps | Q12 |
| D | Today and quick-add usable at 375 px before deploying **(owner: scope)** | #14 |
| M5 | Optimistic locking (`version` column checked inside the batch) once the MCP endpoint and the UI can write at the same time | #5 |
| M5 | Undo of old events across schema changes: intersect recorded keys with current columns | Q6 |

Already done in M2: `event.undo` takes `event_ids` and undoes one op's changes atomically; `events.undone_by` can be set once only (migration 0003); rule violations carry `details.rule`; unchanged saves return 200 with no events; same-site JSON-only writes.

### 10. Testing and reliability strategy

The two things that must never break are "a submitted block is saved" and "the metrics are right", so they get the most testing. Tests run with Vitest in Cloudflare's Workers test pool, against a fresh local D1 database, with no network.

#### Tests

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

#### Reliability measures

- **Write first, render second.** Every UI action is a request that commits to D1 before the UI shows success. No state lives only in the browser.
- **Atomic operations:** each op sends its entity changes and its `events` row as one `db.batch()`, which D1 applies all or nothing.
- **Backups** in four layers (section 2): Time Travel, nightly export to R2, weekly laptop pull, and an export before every deploy.
- **Append-only events,** enforced by triggers, provide the audit trail and Undo.
- **Interrupted sessions:** an `active` block survives a browser restart because its state is in the database; the Now card resumes it. Unsent chat text is kept in the browser's local storage.
- **Day close is idempotent,** and runs from a cron trigger at your day-close time if you skip it. Cron runs in UTC, so your time zone is stored in settings and converted.
- **Free-tier guard:** the settings page shows today's D1 reads and writes and warns at 70% of the limit.
- **Failure isolation:** AI and automation calls are caught at their edges; no write path depends on either.
- **Auth on every request:** the Access JWT check runs before any route, and is tested.

#### Token benchmark

Reported savings of 80 to 90% come from other workloads and are not assumed here. The benchmark uses your real trial data as its primary source. The synthetic seed is used only until real data exists, and for the tests in the repository. A frozen, versioned evaluation set of about 50 questions with known answers is built from real use, so any loss of information shows up. Real data stays local and out of the repo. Before anything is sent to an external provider, names are replaced with stable placeholders. Metrics are tokens, retrieval accuracy, answer accuracy, latency and estimated cost. The benchmark runs eight real Personal OS workloads (W1 to W8, defined in the companion doc). It compares a naive full-context baseline (B0) and the current context pack (B1) against each optimisation stage. A stage stays only if it cuts tokens by at least 25% with no drop in answer quality on the golden checks. Details are in the context management doc (a companion doc, not included).

#### Record retention

Meaningful records are kept indefinitely, and nothing meaningful is deleted automatically. Growth is managed by archiving, indexing and summaries. Full policy: section 5a of the context management doc (a companion doc, not included).

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

#### Schema change in M2

Migration `0002_weekly_outcome_archive.sql` rebuilds `weekly_outcomes` with an `archived_at` column and replaces
`UNIQUE (week, position)` with a partial unique index on `(week, position) WHERE archived_at IS NULL`, so clearing an
outcome archives it instead of deleting it (the "never hard-delete" rule).

---

## Part 4. M2 frontend handoff (docs/handoff/M2-frontend.md, verbatim; its section 4 is the M2 API contract)


Status: ready for OpenCode once the **M2-API** backend PR (section 4) is merged.
Owner of this document: planning (Claude). Source of truth for product behaviour: [docs/SPEC.md](../SPEC.md) section 5 (screens) and the M2 row of section 8 (roadmap).

Read in this order: this file, [AGENTS.md](../../AGENTS.md), SPEC section 5.

---

### 1. What M1 delivered (verified on `m1-foundation`, PR #1, CI green)

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

### 2. Run the backend locally

```sh
npm install
cp .dev.vars.example .dev.vars        # PowerShell: Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev                           # serves public/ and /api/* on http://localhost:8787
npm run seed:local                    # second terminal, once
```

`wrangler dev` serves `public/` as static assets with no build step, and any non-`/api` path falls back to `public/index.html` (single-page app). Edit a file in `public/` and reload the browser.

To start again from empty: stop the server, delete `.wrangler/state`, then migrate and seed again.

### 3. API contract (M1, stable)

All requests and responses are JSON. Same origin, so no CORS and no auth in local development (milestone D adds Cloudflare Access in front; the frontend needs no changes for it, but must handle a 401/403 by showing "Signed out, reload").

#### 3.1 Envelopes

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

#### 3.2 Value conventions

- IDs: 26-character ULID strings. Treat as opaque.
- Booleans in rows are integers `0` / `1`. Send booleans in op inputs as JSON `true` / `false`.
- Days: `"YYYY-MM-DD"` (local calendar day in the user's time zone). Timestamps: UTC ISO-8601 strings.
- Absent values are `null`. In update ops, omit a field to leave it unchanged; send `null` to clear it.
- Weekdays: `0` = Monday ... `6` = Sunday. Week = ISO week, Monday start. Default planning days Monday to Saturday (`settings.planning_days`).

#### 3.3 Read endpoints

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

#### 3.4 Write endpoint

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

### 4. M2-API contract (built by Claude Code on `be/m2-api`)

> **Approved by the owner on 27 Nov 2026** as gaps G1 to G6. Claude Code built them on `be/m2-api`. Code against this section once that PR is merged; until then use the fixtures in `test/fixtures/api/` (real responses from a synthetic week, 2026-W49; regenerate with `npm run fixtures:api`). The shapes are also defined as Zod schemas in `src/api/contract.ts`, and CI checks both the live endpoints and the fixtures against them.

#### 4.1 New ops (`POST /api/ops/<name>`)

| Op | Tier | Input (required in bold) | Rules |
| --- | --- | --- | --- |
| `day.set` | A | **day**, available_min (0 to 1440), day_type (`work`\|`leave`\|`sick`\|`light`); at least one of the two | Creates the day's override row from the weekly template if none exists. A `light` day needs `available_min` (`400`). `422` if the day is closed; unchanged values return no events. |
| `day.commit` | A | **day** | Freezes `plan_snapshot` (available minutes, day type, the planned todo and in-progress tasks, the priority ids). `409` if already committed, `422` if nothing is planned or the day is closed. |
| `day.uncommit` | B | **day** | `409` if not committed, `422` once any time block of that day has been submitted (M3). |
| `weekly_outcome.set` | B | **week** (`2026-W48`), **position** (1 to 3), **title**, project_id (or `null`) | Creates the slot or replaces the title and project of the active outcome in that slot. |
| `weekly_outcome.set_status` | A | **id**, **status** (`open`\|`met`\|`partly`\|`missed`) | Unchanged status returns no events. |
| `weekly_outcome.clear` | B | **id** | Archives an `open` outcome so the slot is free again (nothing is deleted). `422` for an outcome that already has a result. |

Undo works on all of them through `event.undo`. Undoing a `day.set` that created the override row returns the day to its template.

#### 4.2 Load rule (used by both views)

- `planned_min`: sum of `estimate_min` over the day's planned tasks with status `todo`, `in_progress` or `done` (dropped, backlog and archived tasks are left out). A task without an estimate counts **30 minutes** and is counted in `unestimated_count`.
- `remaining_min` (day view): the same sum over `todo` and `in_progress` only.
- Leave and sick days have `available_min = 0`, whatever the template or override says (`configured_min` keeps the configured figure).
- `load`: `off` on leave and sick days (show the day muted, and if it still holds tasks, a "Move N tasks" prompt; never red); otherwise `over` when `planned_min > available_min` (so a 0-minute work day with any work is over), `high` when `planned_min > 0.9 × available_min`, else `ok`. Colours: `high` amber, `over` red.
- A workstream's `weekly_target_min` = `daily_target_min` × the week's planning days (`settings.planning_days`, default Monday to Saturday) that are not leave or sick.
- Show `unestimated_count` next to the capacity figure (for example "+2 unestimated"), so the total makes sense.
- Both views include `projects`: a map from project id to `{ id, slug, title, status, workstream_id, archived_at }` for every project their cards and outcomes reference (archived ones included), so project tags need no extra request.

Task objects in both views have: `id, title, workstream_id, project_id, milestone_id, status, estimate_min, planned_day, due_day, is_priority, is_deliverable, postpone_count, done_at, created_at`. Within a day they are ordered priority first, then creation order. Workstream objects have: `id, name, colour, daily_target_min, is_core, sort_order, archived_at` (archived workstreams appear only while they still have tasks in view).

#### 4.3 `GET /api/day/:day`

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

#### 4.4 `GET /api/week/:isoWeek`

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

#### 4.5 `POST /api/quickadd/parse`

Body `{ "text": "prod: SOP template 45m tue !", "today"?: "2026-11-27" }` (`today` defaults to `/api/today`; at most 500 characters). Nothing is saved. Returns:

```json
{
  "input": { "title": "SOP template", "workstream_id": "01K...", "estimate_min": 45, "planned_day": "2026-12-01", "is_priority": true, "source": "quick_add" },
  "workstream": { "id": "01K...", "name": "Production and creative practice", "colour": "#a26bff" },
  "warnings": []
}
```

Syntax: an optional `alias: ` first (a colon **followed by a space**, so "14:30" is never an alias), then the title, then modifiers read **from the end only**, each a separate word (so a title may contain "tue", and "Launch!" keeps its "!"). An alias matches, in this order: the workstream's full name or initials (`bd`); the start of its first word (`prod`, `a` for AI, `c` for Client); or, with 3+ letters, the start of a later word other than and/of/the (`admin`). Several matches give a warning and no `workstream_id`; no match leaves the text in the title ("Meeting: Q4 review") with a warning. Estimates `45m`, `45min`, `2h`, `1.5h`, `1h30m`; days `today`, `tomorrow`/`tmr`, `mon` to `sun` or full names (next occurrence, today included), `YYYY-MM-DD`; `!` priority; `*` deliverable. `!` without a day is dropped with a warning (a priority belongs to a day). Warnings (never errors): no or ambiguous workstream, no title, day in the past, no estimate, priority without a day. The UI shows each parsed field as a removable chip (removing an estimate or day chip puts that word back into the title), shows the warnings, then sends `input` to `task.create`.

#### 4.6 Not in M2

G7 (manual ordering inside a cell) is deferred: cards sort by priority, then creation.

### 5. Frontend specification (M2 scope)

From SPEC section 5. Only what M2 needs; Projects and Review views show a "Coming in M4" placeholder.

#### 5.1 Shell

- Single page, hash routes: `#/today` (default), `#/week`, `#/week/2026-W48`, `#/projects`, `#/review`.
- **Top bar** (always visible): date and ISO week from `/api/today`; a Next card placeholder reading "Time blocks arrive in M3"; quick-add field (focus with `/` or Ctrl+K); a small connection dot (API health).
- **Chat rail**: not in M2. Leave a collapsed 0-width slot in the layout grid so M5 can add it without restructuring.
- **Toasts**: every successful write shows "Saved" with **Undo** for 10 seconds (none when `eventIds` is empty); errors show `error.message` and stay until dismissed or the next action.
- **After every write**, update optimistically, then re-fetch the current view (`/api/day/:day` or `/api/week/:isoWeek`) so server-computed load, `postpone_count` and ordering stay authoritative.

#### 5.2 Today view

| Region | Contents | Data |
| --- | --- | --- |
| Header strip | Up to 3 priority tasks with checkboxes; plan state chip: Draft, Committed (with time) | G4 `priorities`, `committed_at` |
| Main left (60%) | Placeholder panel "Time-block timeline (M3)" | none |
| Main right (40%) | Tasks for today grouped by workstream (lane colour as a 3 px left border), checkbox, estimate, project tag, star toggle for priority, `↻N` badge; capacity bar `planned / available` coloured by `load` | G4 |
| Day settings | A small control beside the capacity bar: day type (work, light, leave, sick) and available minutes for this day only; "Reset to template" undoes the override | `day.set`, `event.undo` |
| Footer | **Commit plan**; once committed it shows the time and an **Uncommit** link (refused with `422 blocks_submitted` from M3) | `day.commit`, `day.uncommit` |

#### 5.3 Week view (the swimlane, primary planning screen)

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

#### 5.4 Settings panel (gear icon in top bar)

Time zone (select of IANA zones or free text, validated by the server), planning days, the 7-day capacity template. Uses `setting.set` and `capacity.set`. Workstream editing is out of scope for M2.

#### 5.5 Visual style

Dark, restrained command-centre look (SPEC section 5, Visual style): near-black blue-grey background, one accent colour, workstream colours only as thin borders and tags, system UI font, tabular numbers, no gradients or badges beyond `↻N`, 150 ms transitions. Usable from 1280 px wide; below 900 px lanes scroll horizontally. Visible focus outlines; every control reachable by keyboard; colour is never the only signal (load also shows a word or icon).

#### 5.6 Front-end code structure (no build step, no npm packages in the browser)

```text
public/
  index.html              app shell markup only
  css/app.css             the one stylesheet; CSS custom properties for every colour and size
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

### 6. Testing and integration

| Step | Who | What |
| --- | --- | --- |
| Contract | Claude Code | The M2-API PR adds `test/shared/contract.suite.ts`, which calls each endpoint in section 3 and 4 and checks the response shape, and writes the fixtures in `test/fixtures/api/`. Runs on both adapters in CI. |
| Frontend unit | OpenCode | Pure helpers (date maths, load formatting, quick-add display) go in `public/js/lib/` and get tests in `test/frontend/*.test.ts`, run by the existing Vitest node project (no new dependency). |
| Manual checklist | OpenCode, then the owner | `docs/handoff/M2-checklist.md` (OpenCode writes it from section 5): plan a real week in under 10 minutes, drag across days and lanes, overload turns red, 4th priority refused, duplicate prompt, undo, commit, reload keeps everything. |
| Integration review | Claude Code (step 6 of the workflow) | Reviews the frontend PR against this contract: only `api.js` calls fetch, no writes outside `/api/ops`, no files outside `public/` and `test/frontend/` changed, CI green, checklist passes on `wrangler dev`. |
| Browser automation | Later | Playwright only if regressions appear (a dependency, needs approval). |

### 7. Order of work

1. the owner approves section 4 (done, 27 Nov 2026).
2. Claude Code: branch `be/m2-api`, builds G1 to G6 with tests and fixtures, PR, merge.
3. OpenCode/GLM: branch `fe/m2-dashboard` from the updated `main`, builds section 5, PR.
4. Optional: DeepSeek via OpenCode reviews or debugs on its own `fe/m2-dashboard-ds` branch (PR into `fe/m2-dashboard`), never on `be/`.
5. Claude Code: integration review; the owner runs the checklist and merges.

---

## Part 5. Review questions

Answer each one. Reference sections as "SPEC 7 Metric definitions" or "Handoff 4.2".

**A. Product and accountability logic**

1. Does the core loop (plan, commit, time-block, submit, score, review) hold up for one person using it every day for months? Where is it most likely to be abandoned, and what is the smallest change that would prevent that?
2. Check the metric definitions in SPEC 7 (execution, adherence, focus, the composite score and reward tiers). Can any of them be gamed, divide by zero, punish a legitimate change of plan (leave, sick, a client emergency), or disagree with each other?
3. Is the commit moment (`day.commit`, Handoff 4.1) defined tightly enough for adherence to be measured later? What should happen to a task added, moved or dropped after commit?
4. Is the M2 load rule (Handoff 4.2) right: the 30-minute default for unestimated tasks, counting done tasks in `planned_min`, the 90% amber threshold, and leave and sick days forced to 0 minutes?

**B. Data model and integrity**

5. Review the schema (SPEC 3). Name any missing constraint, index or column that will hurt within the MVP (milestones M1 to M4), and any table that is premature.
6. All writes go through typed ops that record before and after rows in an append-only `events` table, with undo by event id. What edge cases break this (concurrent edits from two tabs, undo after a later change, undo of a creation, schema changes over time)?
7. The "never hard-delete" rule: is it applied consistently? Note that undoing a creation of a non-archivable record (a task dependency, a per-day override) removes that row while the event log keeps its contents. Is that acceptable?

**C. API contract for the frontend (Handoff 3 and 4)**

8. Can a vanilla-JS frontend build the Today and Week views (Handoff 5) from these endpoints alone, with no extra requests per card? List anything missing or awkward.
9. Are the error codes and envelopes enough for good UX (Handoff 3.1)? Is anything ambiguous for the frontend author?
10. Quick-add (Handoff 4.5): find inputs that parse surprisingly, such as titles ending in a weekday or a number, aliases that match two workstreams, or times like "2h" in a title. Is "modifiers only at the end" the right rule?

**D. Architecture, security and operations**

11. Are Cloudflare's free-tier limits (Workers CPU time, D1 size and query limits, R2) a real risk for this app in its first year? Which operation is closest to a limit?
12. Review the authentication plan (Cloudflare Access JWT for UI and API, OAuth for the later MCP endpoint, scoped tokens for inbound integrations) and the backup, restore and export procedures (SPEC 2). What is missing before personal data goes on the internet?
13. Is the multi-environment workflow (Part 2, AGENTS.md) safe? Where could two coding agents still overwrite or contradict each other, and how would you tighten it?

**E. Scope**

14. What in the roadmap (SPEC 8) should be cut, merged or moved earlier? What risk is the plan not addressing at all?

## Part 6. Output format

Reply in Markdown with exactly these sections:

1. **Verdict** (3 sentences at most): is the design sound enough to continue with M2 as planned? Yes, yes with changes, or no.
2. **Findings table**, ordered by severity:

   | # | Severity (blocker / high / medium / low) | Area (A to E) | Where (section or field) | Problem | Recommended change | Effort (S / M / L) |

3. **Answers to questions 1 to 14**, numbered, 2 to 6 sentences each. Point to findings by number instead of repeating them.
4. **Questions for the owner**: decisions only the owner can make, each with your recommended answer.
5. **What you would not change**: up to five design choices you think are right, so they are not reopened.

Keep the whole reply under about 2,500 words.
