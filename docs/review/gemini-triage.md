# Gemini review triage (27 Nov 2026)

Verdict from Gemini: "Yes, with changes." Triage by Claude Code. "Fixed" means done in PR #3 (`be/m2-api`); "Logged" means added to the review backlog in SPEC section 8.

| # | Finding | Decision | What happened |
| --- | --- | --- | --- |
| 1 | `tasks.archived_at` missing from SPEC 3 | **Accepted (spec only)** | The code already has it (`0001_init.sql`). The spec sketch had drifted, so SPEC 3 now copies the migrations verbatim. |
| 2 | Dragging a backlog task onto a day leaves it out of load and Commit | **Accepted, fixed** | Scheduling a backlog task makes it `todo`; `status: backlog` clears the day; both can't hold at once. |
| 3 | `actual_start` needed on `time_blocks` | Accepted, logged for M3 | |
| 4 | Metric formula flaws (Execution, Focus, Adherence, Composite) | Accepted, logged for M3 | Changing metric formulas needs your approval (CLAUDE.md), so the rewrite is listed as an owner decision before M3. |
| 5 | Races between two tabs; multi-call undo | **Partly fixed** | Undo now takes `event_ids` and is all or nothing. Optimistic locking is logged for M5, when MCP and the UI can write together. For one person in one tab the race is unlikely. |
| 6 | Project tags, ISO week, no UI for `day.set` and Uncommit | **Accepted, fixed** | Views return a `projects` map; `/api/today` returns `week`; the handoff adds day settings and Uncommit controls. |
| 7 | Access vs MCP and webhooks, 302 on expiry, CSRF | **Partly fixed** | Same-site JSON-only writes are in now; the handoff tells `api.js` to handle 302, 401 and non-JSON. Bypass paths and fail-closed are logged for D. |
| 8 | Leave days show red; light days; weekly targets; post-commit edits | **Accepted, fixed** | Leave and sick days now show `off`, not red. Light days need minutes. Targets skip leave days. Post-commit rules are logged for M3. |
| 9 | Indexes, the `last_activity_at` trigger, the events trigger, priority with no day | **Mostly fixed** | `last_activity_at` was already set in ops (spec text fixed). `undone_by` can be set only once (migration 0003). A priority now needs a day. M3 and M4 indexes and the block CHECK are logged. `tasks(project_id, status)` already exists. |
| 10 | 409 on unchanged saves; no `details.rule`; 401 and 429 not documented | **Accepted, fixed** | |
| 11 | Quick-add edge cases | **Accepted, fixed** | Needs `alias: ` with a space; an unmatched prefix stays in the title; matching tightened (`a` → AI, `c` → Client); removable chips are in the handoff. Short trailing modifiers like "Cable 2m" are still parsed, and the chips make them easy to undo. |
| 12 | Export too big for 10 ms CPU; D1 gauge | Accepted, logged for D | Export already reads in pages of 500 but returns one response. |
| 13 | DeepSeek on the same branch; `public/js/lib/`; no frontend checks | **Accepted, fixed** | DeepSeek gets its own `fe/<topic>-ds` branch; `check:public` in `npm run check`; `test/frontend/` runs in Vitest. |
| 14 | Project creation before M4; mobile before D; recovery after time away; defer A and G | Split | Recovery and drafts are logged for M3. Project creation in M2, mobile before D, and deferring A and G change scope, so they are owner questions. |
| 15 | Premature tables; "Pydantic" in the spec | Accepted | "Pydantic" is now "Zod". The applied tables stay; no M5+ ops until their milestone. |

Not accepted: Gemini said `events_no_update` lets `day`, `actor` and `entity_id` change. It doesn't; the 0001 trigger already blocks every column except `undone_by`. Migration 0003 closes the remaining gap.

Needs your approval: Gemini suggested writing into CLAUDE.md that link, join and day-override rows may be removed on unlink or undo (their contents stay in events). The code already works that way, and Gemini called it acceptable. It loosens a CLAUDE.md rule, though, so I haven't changed it.
