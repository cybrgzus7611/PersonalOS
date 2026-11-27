import { Hono, type Context } from "hono";
import type { Db } from "../db.ts";
import { OpError } from "../errors.ts";
import { registry as defaultRegistry } from "../ops/index.ts";
import type { OpRegistry } from "../ops/registry.ts";
import { ENTITIES, isEntityType } from "../ops/entities.ts";
import { readSetting, readSettings } from "../services/settings.ts";
import { search } from "../services/search.ts";
import { exportAll, isExportTable, tableToCsv } from "../services/export.ts";
import { seed } from "../seed.ts";
import { localDay } from "../time.ts";
import { dayView, weekView } from "../services/planning.ts";
import { parseQuickAdd } from "../services/quickadd.ts";

export interface AppDeps {
  /** Resolve the database for this request (D1 on Cloudflare, node:sqlite in tests and scripts). */
  getDb(c: Context): Db;
  /** True only in local development: enables /api/admin/* helpers. */
  isDev(c: Context): boolean;
  registry?: OpRegistry;
}

const FILTERABLE = ["status", "project_id", "workstream_id", "objective_id", "milestone_id", "planned_day", "due_day", "kind", "day"];
const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function errorBody(err: OpError) {
  return { error: { code: err.code, message: err.message, details: err.details ?? null } };
}

export function createApp(deps: AppDeps): Hono {
  const registry = deps.registry ?? defaultRegistry;
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof OpError) return c.json(errorBody(err), err.status as 400);
    if (err instanceof SyntaxError) return c.json(errorBody(new OpError("invalid_input", "request body is not valid JSON")), 400);
    console.error(err);
    return c.json({ error: { code: "internal", message: "internal error", details: null } }, 500);
  });

  app.notFound((c) => c.json({ error: { code: "not_found", message: `no route for ${c.req.method} ${c.req.path}`, details: null } }, 404));

  // Security headers for every API response. (The Access JWT check arrives in milestone D.)
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  app.get("/api/health", async (c) => {
    const db = deps.getDb(c);
    const migrations = await db.all<{ name: string }>("SELECT name FROM d1_migrations ORDER BY id").catch(() => []);
    return c.json({ ok: true, migrations: migrations.map((m) => m.name) });
  });

  app.get("/api/ops", (c) => c.json({ ops: registry.list() }));

  app.post("/api/ops/:name", async (c) => {
    const db = deps.getDb(c);
    const body = await c.req.json().catch(() => {
      throw new OpError("invalid_input", "request body must be a JSON object");
    });
    const timeZone = await readSetting(db, "timezone");
    // Every REST caller is the user for now; scoped AI, automation and agent callers arrive in M5, A and G.
    const outcome = await registry.run(db, c.req.param("name"), body, { actor: "user", timeZone });
    return c.json(outcome, 200);
  });

  app.get("/api/settings", async (c) => c.json({ settings: await readSettings(deps.getDb(c)) }));

  app.get("/api/capacity", async (c) => {
    const rows = await deps.getDb(c).all("SELECT * FROM capacity_template ORDER BY weekday");
    return c.json({ capacity: rows });
  });

  app.get("/api/today", async (c) => {
    const db = deps.getDb(c);
    const tz = await readSetting(db, "timezone");
    return c.json({ day: localDay(tz), timezone: tz });
  });

  app.get("/api/day/:day", async (c) => c.json(await dayView(deps.getDb(c), c.req.param("day"))));

  app.get("/api/week/:week", async (c) => c.json(await weekView(deps.getDb(c), c.req.param("week"))));

  app.post("/api/quickadd/parse", async (c) => {
    const db = deps.getDb(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.text !== "string" || body.text.length > 500) {
      throw new OpError("invalid_input", "body must be { text } with at most 500 characters");
    }
    const today = typeof body.today === "string" ? body.today : localDay(await readSetting(db, "timezone"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new OpError("invalid_input", "today must be YYYY-MM-DD");
    return c.json(await parseQuickAdd(db, body.text, today));
  });

  app.get("/api/entities/:type", async (c) => {
    const type = c.req.param("type");
    if (!isEntityType(type) || type === "task_dependency") throw new OpError("not_found", `unknown entity type ${type}`);
    const m = ENTITIES[type];
    const db = deps.getDb(c);
    const where: string[] = [];
    const params: (string | number)[] = [];
    const cols = new Set((await db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${m.table}')`)).map((r) => r.name));
    for (const f of FILTERABLE) {
      const v = c.req.query(f);
      if (v === undefined) continue;
      if (!cols.has(f)) throw new OpError("invalid_input", `${type} cannot be filtered by ${f}`);
      where.push(`${f} = ?`);
      params.push(v);
    }
    if (m.archivable && c.req.query("include_archived") !== "1") where.push("archived_at IS NULL");
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 100) || 100, 1), 500);
    const after = c.req.query("after");
    if (after) {
      where.push(`${m.key} > ?`);
      params.push(after);
    }
    const sql = `SELECT * FROM ${m.table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${m.key} LIMIT ?`;
    const rows = await db.all<Record<string, unknown>>(sql, [...params, limit]);
    const next = rows.length === limit ? rows[rows.length - 1][m.key] : null;
    return c.json({ items: rows, next_after: next });
  });

  app.get("/api/entities/:type/:id", async (c) => {
    const type = c.req.param("type");
    if (!isEntityType(type) || type === "task_dependency") throw new OpError("not_found", `unknown entity type ${type}`);
    const m = ENTITIES[type];
    const db = deps.getDb(c);
    const key = type === "capacity" ? Number(c.req.param("id")) : c.req.param("id");
    const row = await db.first(`SELECT * FROM ${m.table} WHERE ${m.key} = ?`, [key]);
    if (!row) throw new OpError("not_found", `${type} ${c.req.param("id")} not found`);
    const body: Record<string, unknown> = { item: row };
    if (c.req.query("include") === "events") {
      body.events = await db.all("SELECT * FROM events WHERE entity_type = ? AND entity_id = ? ORDER BY id", [type, String(key)]);
    }
    if (type === "task") {
      body.depends_on = await db.all("SELECT depends_on_id FROM task_dependencies WHERE task_id = ?", [key]);
    }
    return c.json(body);
  });

  app.get("/api/events", async (c) => {
    const db = deps.getDb(c);
    const where: string[] = [];
    const params: (string | number)[] = [];
    for (const f of ["entity_type", "entity_id", "day", "actor", "op"]) {
      const v = c.req.query(f);
      if (v !== undefined) {
        where.push(`${f} = ?`);
        params.push(v);
      }
    }
    const before = c.req.query("before");
    if (before) {
      if (!ID_RE.test(before)) throw new OpError("invalid_input", "before must be an event id");
      where.push("id < ?");
      params.push(before);
    }
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
    const rows = await db.all(`SELECT * FROM events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`, [...params, limit]);
    return c.json({ items: rows });
  });

  app.get("/api/search", async (c) => {
    const q = c.req.query("q") ?? "";
    const types = c.req.query("types")?.split(",").filter(Boolean);
    const hits = await search(deps.getDb(c), q, { types, limit: Number(c.req.query("limit") ?? 10) || 10 });
    return c.json({ items: hits });
  });

  app.get("/api/export.json", async (c) => {
    const data = await exportAll(deps.getDb(c));
    const stamp = data.exported_at.slice(0, 10);
    c.header("Content-Disposition", `attachment; filename="personal-os-export-${stamp}.json"`);
    return c.json(data);
  });

  app.get("/api/export/:file", async (c) => {
    const file = c.req.param("file");
    const table = file.endsWith(".csv") ? file.slice(0, -4) : "";
    if (!isExportTable(table)) throw new OpError("not_found", `no exportable table ${file}`);
    const csv = await tableToCsv(deps.getDb(c), table);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}.csv"`,
    });
  });

  app.post("/api/admin/seed", async (c) => {
    if (!deps.isDev(c)) throw new OpError("forbidden", "seeding is only available in local development");
    return c.json(await seed(deps.getDb(c), registry));
  });

  return app;
}
