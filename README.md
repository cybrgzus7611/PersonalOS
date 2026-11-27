# Personal OS

A personal planning and accountability system for one user: projects, a weekly swimlane, time-block accountability, and an AI chief of staff on top.

- **Spec:** [docs/SPEC.md](docs/SPEC.md) (snapshot of the living spec).
- **Rules for Claude Code:** [CLAUDE.md](CLAUDE.md).
- **Stack:** TypeScript on one Cloudflare Worker (Hono), D1, R2, plain HTML/CSS/JS. Developed locally with Wrangler first, deployed to Cloudflare's free tier later.

This repository holds code only. Personal data lives in D1/R2 and local backups, never here.

## Local development (Windows, macOS or Linux)

Needs Node.js 22.13 or later. No Cloudflare account is needed yet.

```sh
npm install
cp .dev.vars.example .dev.vars        # Windows PowerShell: Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local              # creates the local D1 database under .wrangler/
npm run dev                           # http://localhost:8787
npm run seed:local                    # in a second terminal: loads workstreams, capacity, brain documents
```

Useful endpoints while there is no UI yet:

| What | Request |
| --- | --- |
| Health and applied migrations | `GET /api/health` |
| All operations with their input schemas and risk tiers | `GET /api/ops` |
| Run an operation | `POST /api/ops/<name>` with a JSON body, e.g. `POST /api/ops/task.create` |
| List or read records | `GET /api/entities/<type>`, `GET /api/entities/<type>/<id>?include=events` |
| History | `GET /api/events?entity_type=task&entity_id=<id>` |
| Search | `GET /api/search?q=template` |
| Export | `GET /api/export.json`, `GET /api/export/<table>.csv` |

Without Wrangler, `npm run seed:file` creates a plain SQLite file at `.local/personal-os.sqlite` and
`npm run export:file` exports it.

## Tests

```sh
npm run check     # type check, then the same suites on node:sqlite and inside the Workers runtime (local D1)
```
