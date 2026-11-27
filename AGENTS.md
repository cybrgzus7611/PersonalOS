# Working on Personal OS with more than one AI coding environment

This file is read by every coding agent (OpenCode, Claude Code and others). `CLAUDE.md` holds the
architecture rules; they apply to everyone. This file adds who owns what, so separate environments
never overwrite each other.

## Roles

| Environment | Role | Owns (may change) |
| --- | --- | --- |
| Claude (planning, Opus) | Architecture, specs, technical decisions | `docs/SPEC.md`, `docs/handoff/*` (except checklists below), `CLAUDE.md`, `AGENTS.md` |
| Gemini | Independent review of plans and specs | Nothing in the repo; reviews go in PR comments or the project chat |
| Claude Code | Backend, database, API, tests, CI | `src/`, `migrations/`, `test/` (except `test/frontend/`), `scripts/`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.github/` |
| OpenCode (currently DeepSeek V4.1 Flash) | Frontend | `public/`, `test/frontend/`, `docs/handoff/M*-checklist.md` |
| OpenCode with a second model (for example GLM) | Alternative model for frontend tasks, comparison and debugging | Same folders, on its own `fe/<topic>-<model>` branch |
| Integration review | Claude Code, then Nisa | Reviews only; fixes go back to the owning environment |

If a change is needed outside your area, **do not make it**. Write it down in your PR description
under "Needs from other environments" (for example a missing endpoint) and stop that part of the work.

## Branches and pull requests

- `main` is protected by convention: every change arrives through a pull request with CI green.
- Branch names show the owner: `be/<topic>` (Claude Code), `fe/<topic>` (OpenCode), `docs/<topic>` (planning).
- One environment per branch. Never push to another environment's branch. A second OpenCode model
  works on `fe/<topic>-<model>`, branched from the main frontend branch; its changes reach
  `fe/<topic>` only through a PR.
- Start every branch from the latest `main`. Before opening the PR, merge the latest `main` into your
  branch (do not rebase a branch someone else may have pulled).
- PR title starts with the milestone, e.g. `M2 frontend: Today and Week views`. The description states
  which environment and model wrote it.
- Backend changes that the frontend depends on merge first. The frontend never works around a missing
  endpoint by writing to the database or adding server code.

## Rules every environment follows

- The API contract is `docs/handoff/M2-frontend.md` sections 3 and 4 (and later handoffs). If code and
  contract disagree, stop and report it; do not change one to match the other on your own.
- The frontend changes data only through `POST /api/ops/<name>`, from `public/js/api.js` only.
- No new dependencies (npm or browser) without Nisa's approval. No CDNs, external fonts or analytics.
- Never commit personal data, `.dev.vars`, `.wrangler/`, exports or backups.
- Run `npm run check` before every push. It must pass. It includes `check:public`, which blocks `fetch(`
  outside `public/js/api.js`, HTML built from strings, other-origin URLs and inline scripts or handlers.
- Do not reformat or "tidy" files you do not own; it creates conflicts for the owner.
