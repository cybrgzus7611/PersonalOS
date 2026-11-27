import { describe, expect, it } from "vitest";
import type { Hono } from "hono";
import type { Db } from "../../src/db.ts";
import { createApp } from "../../src/api/app.ts";
import { uniq, usedOps, type Fresh } from "./fixtures.ts";

async function call(app: Hono, method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const type = res.headers.get("Content-Type") ?? "";
  return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : await res.text() } as {
    status: number;
    headers: Headers;
    body: any;
  };
}

function appFor(db: Db, dev = true) {
  return createApp({ getDb: () => db, isDev: () => dev });
}

export function apiSuite(fresh: Fresh) {
  describe("REST API", () => {
    it("reports health and applied migrations", async () => {
      const r = await call(appFor(await fresh()), "GET", "/api/health");
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.migrations).toContain("0001_init.sql");
      expect(r.headers.get("Cache-Control")).toBe("no-store");
    });

    it("runs ops and maps errors to status codes", async () => {
      const db = await fresh();
      const app = appFor(db);
      usedOps.add("workstream.create");
      const ok = await call(app, "POST", "/api/ops/workstream.create", { name: uniq("API WS") });
      expect(ok.status).toBe(200);
      expect(ok.body.eventIds).toHaveLength(1);
      const wsId = ok.body.result.id;
      expect((await call(app, "POST", "/api/ops/workstream.create", { name: 5 })).status).toBe(400);
      expect((await call(app, "POST", "/api/ops/workstream.create", "{not json")).status).toBe(400);
      const unknown = await call(app, "POST", "/api/ops/nope.op", {});
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe("unknown_op");
      expect((await call(app, "POST", "/api/ops/workstream.create", { name: ok.body.result.name })).status).toBe(409);
      expect((await call(app, "POST", "/api/ops/task.reopen", { id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" })).status).toBe(404);
      const t = await call(app, "POST", "/api/ops/task.create", { title: uniq("API task"), workstream_id: wsId, planned_day: "2091-01-01", is_priority: true });
      expect(t.status).toBe(200);
      const got = await call(app, "GET", `/api/entities/task/${t.body.result.id}?include=events`);
      expect(got.body.item.title).toBe(t.body.result.title);
      expect(got.body.events).toHaveLength(1);
      expect(got.body.depends_on).toEqual([]);
    });

    it("lists entities with filters and paging", async () => {
      const db = await fresh();
      const app = appFor(db);
      const ws = (await call(app, "POST", "/api/ops/workstream.create", { name: uniq("List WS") })).body.result;
      for (let i = 0; i < 3; i++) await call(app, "POST", "/api/ops/task.create", { title: uniq(`List task ${i}`), workstream_id: ws.id });
      const page1 = await call(app, "GET", `/api/entities/task?workstream_id=${ws.id}&limit=2`);
      expect(page1.body.items).toHaveLength(2);
      const page2 = await call(app, "GET", `/api/entities/task?workstream_id=${ws.id}&limit=2&after=${page1.body.next_after}`);
      expect(page2.body.items).toHaveLength(1);
      expect((await call(app, "GET", "/api/entities/workstream?planned_day=2026-01-01")).status).toBe(400);
      expect((await call(app, "GET", "/api/entities/nope")).status).toBe(404);
      const events = await call(app, "GET", `/api/events?entity_type=workstream&entity_id=${ws.id}`);
      expect(events.body.items).toHaveLength(1);
    });

    it("searches, exports and protects admin routes", async () => {
      const db = await fresh();
      const app = appFor(db);
      const word = `quokka${Date.now()}`;
      usedOps.add("idea.capture");
      await call(app, "POST", "/api/ops/idea.capture", { title: `Animated ${word} explainer` });
      const hits = await call(app, "GET", `/api/search?q=${word}`);
      expect(hits.body.items[0].snippet).toContain(word);
      const json = await call(app, "GET", "/api/export.json");
      expect(json.headers.get("Content-Disposition")).toContain("personal-os-export-");
      expect(json.body.tables.ideas.length).toBeGreaterThan(0);
      const csv = await call(app, "GET", "/api/export/ideas.csv");
      expect(csv.headers.get("Content-Type")).toContain("text/csv");
      expect(csv.body.split("\r\n")[0]).toContain("title");
      expect((await call(app, "GET", "/api/export/search.csv")).status).toBe(404);
      expect((await call(appFor(db, false), "POST", "/api/admin/seed")).status).toBe(403);
      expect((await call(app, "GET", "/api/settings")).body.settings.timezone).toBeTypeOf("string");
      expect((await call(app, "GET", "/api/ops")).body.ops.length).toBeGreaterThan(30);
      expect((await call(app, "GET", "/api/nothing-here")).status).toBe(404);
    });
  });
}
