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
