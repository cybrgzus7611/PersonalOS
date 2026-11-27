# Personal OS

A personal planning and accountability system for one user: projects, a weekly swimlane, time-block accountability, and an AI chief of staff on top.

- **Spec:** [docs/SPEC.md](docs/SPEC.md) (snapshot of the living spec).
- **Rules for Claude Code:** [CLAUDE.md](CLAUDE.md).
- **Stack:** TypeScript on one Cloudflare Worker (Hono), D1, R2, plain HTML/CSS/JS. Developed locally with Wrangler first, deployed to Cloudflare's free tier later.

This repository holds code only. Personal data lives in D1/R2 and local backups, never here.
