import { describe, expect, it } from "vitest";
import type { Db } from "../../src/db.ts";
import { registry } from "../../src/ops/index.ts";
import { seed, SEED_WORKSTREAMS } from "../../src/seed.ts";
import { search } from "../../src/services/search.ts";
import { eventsFor, expectFail, makeProject, makeTask, makeWorkstream, run, uniq, uniqDay, usedOps, type Fresh } from "./fixtures.ts";

/** `empty` must return a migrated database with no rows (the seed test needs one). */
export function opsSuite(fresh: Fresh, empty: Fresh) {
  describe("ops framework", () => {
    it("writes exactly one event per changed entity, with actor and before/after", async () => {
      const db = await fresh();
      const out = await run(db, "workstream.create", { name: uniq("WS"), colour: "#123456" }, { actor: "system" });
      expect(out.eventIds).toHaveLength(1);
      const [ev] = await eventsFor(db, "workstream", out.result.id);
      expect(ev).toMatchObject({ id: out.eventIds[0], actor: "system", op: "workstream.create", before_json: null });
      expect(JSON.parse(ev.after_json).colour).toBe("#123456");
    });

    it("rejects invalid input with no writes", async () => {
      const db = await fresh();
      const err = await expectFail(db, "workstream.create", { name: "x", colour: "blue" }, "invalid_input");
      expect(JSON.stringify(err.details)).toContain("colour");
      await expectFail(db, "workstream.create", { name: "x", extra: 1 }, "invalid_input");
      await expectFail(db, "no.such.op", {}, "unknown_op");
    });

    it("keeps events append-only", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const [ev] = await eventsFor(db, "workstream", ws.id);
      await expect(db.batch([{ sql: "UPDATE events SET op = 'tampered' WHERE id = ?", params: [ev.id] }])).rejects.toThrow(/append-only/);
      await expect(db.batch([{ sql: "DELETE FROM events WHERE id = ?", params: [ev.id] }])).rejects.toThrow(/append-only/);
    });

    it("applies a batch all-or-nothing", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      await expect(
        db.batch([
          { sql: "UPDATE workstreams SET name = ? WHERE id = ?", params: ["changed in a failed batch", ws.id] },
          { sql: "INSERT INTO tasks (id) VALUES (NULL)", params: [] },
        ]),
      ).rejects.toThrow();
      const row = await db.first<{ name: string }>("SELECT name FROM workstreams WHERE id = ?", [ws.id]);
      expect(row?.name).toBe(ws.name);
    });

    it("lists every op with a tier and a JSON schema", () => {
      const ops = registry.list();
      expect(ops.length).toBeGreaterThan(30);
      for (const op of ops) {
        expect(["A", "B"]).toContain(op.tier);
        expect(op.input).toBeTypeOf("object");
      }
    });
  });

  describe("workstreams", () => {
    it("creates, updates, refuses duplicate names, archives and unarchives", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db, { daily_target_min: 60, is_core: true });
      expect(ws).toMatchObject({ is_core: 1, daily_target_min: 60, archived_at: null });
      await expectFail(db, "workstream.create", { name: ws.name.toUpperCase() }, "duplicate");
      const upd = await run(db, "workstream.update", { id: ws.id, daily_target_min: 90 });
      expect(upd.result.daily_target_min).toBe(90);
      await expectFail(db, "workstream.update", { id: ws.id }, "invalid_input");
      await run(db, "workstream.archive", { id: ws.id });
      await expectFail(db, "workstream.archive", { id: ws.id }, "conflict");
      await expectFail(db, "workstream.update", { id: ws.id, daily_target_min: 1 }, "rule_violation");
      await run(db, "workstream.unarchive", { id: ws.id });
      await expectFail(db, "workstream.unarchive", { id: ws.id }, "conflict");
    });
  });

  describe("objectives, projects, milestones", () => {
    it("runs the objective lifecycle", async () => {
      const db = await fresh();
      const { result: obj } = await run(db, "objective.create", { title: uniq("Objective"), horizon: "year" });
      const { result: upd } = await run(db, "objective.update", { id: obj.id, status: "achieved" });
      expect(upd.status).toBe("achieved");
      await run(db, "objective.archive", { id: obj.id });
      await run(db, "objective.unarchive", { id: obj.id });
    });

    it("creates projects with unique slugs and checks references", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const title = uniq("Safety Explainer");
      const a = await makeProject(db, ws.id, { title });
      const b = await makeProject(db, ws.id, { title });
      expect(a.slug).toMatch(/^safety-explainer-/);
      expect(b.slug).toBe(`${a.slug}-2`);
      await expectFail(db, "project.create", { title: "x", workstream_id: ws.id, slug: a.slug }, "duplicate");
      await expectFail(db, "project.create", { title: "x", workstream_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, "invalid_input");
      const archivedWs = await makeWorkstream(db);
      await run(db, "workstream.archive", { id: archivedWs.id });
      await expectFail(db, "project.create", { title: "x", workstream_id: archivedWs.id }, "rule_violation");
    });

    it("updates projects through separate tiered ops", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const p = await makeProject(db, ws.id, { client_name: "Acme" });
      expect((await run(db, "project.update", { id: p.id, description: "Onboarding videos" })).result.description).toBe("Onboarding videos");
      await expectFail(db, "project.update", { id: p.id, status: "done" }, "invalid_input");
      expect((await run(db, "project.set_status", { id: p.id, status: "paused" })).result.status).toBe("paused");
      await expectFail(db, "project.set_status", { id: p.id, status: "paused" }, "conflict");
      expect((await run(db, "project.set_priority", { id: p.id, priority: 1 })).result.priority).toBe(1);
      expect((await run(db, "project.set_due_day", { id: p.id, due_day: "2026-12-19" })).result.due_day).toBe("2026-12-19");
      await run(db, "project.archive", { id: p.id });
      await run(db, "project.unarchive", { id: p.id });
      expect(registry.get("project.set_priority")?.tier).toBe("B");
    });

    it("runs the milestone lifecycle", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const p = await makeProject(db, ws.id);
      const { result: m } = await run(db, "milestone.create", { project_id: p.id, title: "First demo reel" });
      await run(db, "milestone.update", { id: m.id, title: "First demo reel published" });
      await run(db, "milestone.set_due_day", { id: m.id, due_day: "2026-12-31" });
      const done = await run(db, "milestone.set_status", { id: m.id, status: "done" });
      expect(done.result.done_at).toBeTruthy();
      await run(db, "milestone.archive", { id: m.id });
      await run(db, "milestone.unarchive", { id: m.id });
    });
  });

  describe("tasks", () => {
    it("creates a task, touches its project and indexes it for search", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const p = await makeProject(db, ws.id);
      await db.batch([{ sql: "UPDATE projects SET last_activity_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", params: [p.id] }]);
      const word = `zephyrine${Date.now()}`;
      const t = await makeTask(db, ws.id, { project_id: p.id, title: `Record ${word} captions`, estimate_min: 45, is_deliverable: true });
      expect(t).toMatchObject({ status: "todo", is_deliverable: 1, source: "user", postpone_count: 0 });
      const proj = await db.first<{ last_activity_at: string }>("SELECT last_activity_at FROM projects WHERE id = ?", [p.id]);
      expect(proj?.last_activity_at).not.toBe("2000-01-01T00:00:00.000Z");
      const hits = await search(db, word);
      expect(hits.map((h) => h.entity_id)).toContain(t.id);
      await run(db, "task.archive", { id: t.id });
      expect((await search(db, word)).map((h) => h.entity_id)).not.toContain(t.id);
      await run(db, "task.unarchive", { id: t.id });
      expect((await search(db, word)).map((h) => h.entity_id)).toContain(t.id);
    });

    it("refuses near-duplicate open tasks unless allowed", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const p = await makeProject(db, ws.id);
      const t = await makeTask(db, ws.id, { project_id: p.id, title: "Screen-recording animation for template intro" });
      const err = await expectFail(db, "task.create", { title: "screen recording animation for template intro", workstream_id: ws.id, project_id: p.id }, "duplicate");
      expect(err.details.task_id).toBe(t.id);
      await run(db, "task.create", { title: "Screen recording animation for template intro", workstream_id: ws.id, project_id: p.id, allow_duplicate: true });
      await run(db, "task.create", { title: "Write the narration script", workstream_id: ws.id, project_id: p.id });
    });

    it("allows at most three priorities per day", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const day = uniqDay();
      for (let i = 0; i < 3; i++) await makeTask(db, ws.id, { planned_day: day, is_priority: true });
      await expectFail(db, "task.create", { title: uniq("Fourth"), workstream_id: ws.id, planned_day: day, is_priority: true }, "rule_violation");
      const extra = await makeTask(db, ws.id, { planned_day: day });
      await expectFail(db, "task.update", { id: extra.id, is_priority: true }, "rule_violation");
    });

    it("counts postponements when work moves later or off the plan", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const t = await makeTask(db, ws.id, { planned_day: "2026-11-27" });
      expect((await run(db, "task.update", { id: t.id, planned_day: "2026-11-28" })).result.postpone_count).toBe(1);
      expect((await run(db, "task.update", { id: t.id, planned_day: "2026-11-26" })).result.postpone_count).toBe(1);
      expect((await run(db, "task.update", { id: t.id, planned_day: null })).result.postpone_count).toBe(2);
    });

    it("completes and reopens tasks", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const t = await makeTask(db, ws.id);
      const done = await run(db, "task.complete", { id: t.id });
      expect(done.result).toMatchObject({ status: "done" });
      expect(done.result.done_at).toBeTruthy();
      await expectFail(db, "task.complete", { id: t.id }, "conflict");
      await expectFail(db, "task.update", { id: t.id, status: "todo" }, "rule_violation");
      const re = await run(db, "task.reopen", { id: t.id });
      expect(re.result).toMatchObject({ status: "todo", done_at: null });
      await expectFail(db, "task.reopen", { id: t.id }, "conflict");
    });

    it("checks milestone and project consistency", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const p1 = await makeProject(db, ws.id);
      const p2 = await makeProject(db, ws.id);
      const { result: m } = await run(db, "milestone.create", { project_id: p1.id, title: "M" });
      await expectFail(db, "task.create", { title: uniq("T"), workstream_id: ws.id, project_id: p2.id, milestone_id: m.id }, "rule_violation");
      await makeTask(db, ws.id, { project_id: p1.id, milestone_id: m.id });
    });

    it("records dependencies and refuses cycles", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const a = await makeTask(db, ws.id);
      const b = await makeTask(db, ws.id);
      const c = await makeTask(db, ws.id);
      await run(db, "task.add_dependency", { task_id: b.id, depends_on_id: a.id });
      await run(db, "task.add_dependency", { task_id: c.id, depends_on_id: b.id });
      await expectFail(db, "task.add_dependency", { task_id: a.id, depends_on_id: c.id }, "rule_violation");
      await expectFail(db, "task.add_dependency", { task_id: b.id, depends_on_id: a.id }, "conflict");
      await run(db, "task.remove_dependency", { task_id: c.id, depends_on_id: b.id });
      await expectFail(db, "task.remove_dependency", { task_id: c.id, depends_on_id: b.id }, "not_found");
    });
  });

  describe("ideas, decisions, notes, documents", () => {
    it("keeps ideas in a backlog until promoted", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const { result: idea } = await run(db, "idea.capture", { title: uniq("Interactive safety quiz"), kind: "possible_project" });
      expect(idea.status).toBe("open");
      expect((await run(db, "idea.mention", { id: idea.id })).result.mention_count).toBe(2);
      await run(db, "idea.update", { id: idea.id, notes: "Came up twice in client calls" });
      const out = await run(db, "idea.promote", { id: idea.id, to: "project", workstream_id: ws.id });
      expect(out.eventIds).toHaveLength(2);
      expect(out.result.project.title).toBe(idea.title);
      expect(out.result.idea).toMatchObject({ status: "promoted", promoted_to_type: "project", promoted_to_id: out.result.project.id });
      await expectFail(db, "idea.promote", { id: idea.id, to: "task", workstream_id: ws.id }, "conflict");
      const { result: idea2 } = await run(db, "idea.capture", { title: uniq("Caption style test") });
      const out2 = await run(db, "idea.promote", { id: idea2.id, to: "task", workstream_id: ws.id, estimate_min: 30 });
      expect(out2.result.task).toMatchObject({ title: idea2.title, estimate_min: 30, status: "todo" });
      const { result: idea3 } = await run(db, "idea.capture", { title: uniq("Parked") });
      await run(db, "idea.archive", { id: idea3.id });
      await run(db, "idea.unarchive", { id: idea3.id });
    });

    it("logs decisions and supersedes rather than edits them", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const p = await makeProject(db, ws.id);
      const { result: d1 } = await run(db, "decision.log", { title: "Use HyperFrames for templates", rationale: "Reusable", project_id: p.id });
      expect(registry.get("decision.update")).toBeUndefined();
      const { result: d2 } = await run(db, "decision.supersede", { supersedes_id: d1.id, title: "Use HyperFrames for templates, After Effects for one-offs" });
      expect(d2).toMatchObject({ supersedes_id: d1.id, project_id: p.id });
      await expectFail(db, "decision.supersede", { supersedes_id: d1.id, title: "again" }, "conflict");
      await run(db, "decision.archive", { id: d2.id });
      await run(db, "decision.unarchive", { id: d2.id });
    });

    it("adds, corrects and resolves notes", async () => {
      const db = await fresh();
      const { result: n } = await run(db, "note.add", { kind: "blocker", body: "Waiting on client logo files", day: "2026-11-27" });
      expect(n.day).toBe("2026-11-27");
      await run(db, "note.update", { id: n.id, body: "Waiting on client logo files (SVG)" });
      expect((await run(db, "note.resolve", { id: n.id })).result.resolved_at).toBeTruthy();
      await expectFail(db, "note.resolve", { id: n.id }, "conflict");
      await run(db, "note.resolve", { id: n.id, resolved: false });
      await run(db, "note.archive", { id: n.id });
      await run(db, "note.unarchive", { id: n.id });
    });

    it("versions documents and protects against stale writes", async () => {
      const db = await fresh();
      const path = `projects/${Date.now()}-narrative.md`;
      const v1 = await run(db, "document.put", { path, body: "# Narrative\n\nv1" });
      expect(v1.result.version).toBe(1);
      const v2 = await run(db, "document.put", { path, body: "# Narrative\n\nv2", expected_version: 1 });
      expect(v2.result.version).toBe(2);
      await expectFail(db, "document.put", { path, body: "stale", expected_version: 1 }, "conflict");
      await expectFail(db, "document.put", { path, body: "# Narrative\n\nv2" }, "conflict");
      await expectFail(db, "document.put", { path: "../etc/passwd.md", body: "x" }, "invalid_input");
      const versions = await db.all("SELECT version FROM document_versions WHERE document_id = ? ORDER BY version", [v1.result.id]);
      expect(versions).toEqual([{ version: 1 }, { version: 2 }]);
      await run(db, "document.archive", { id: v1.result.id });
      await run(db, "document.unarchive", { id: v1.result.id });
    });
  });

  describe("settings and capacity", () => {
    it("validates known settings and refuses unknown ones", async () => {
      const db = await fresh();
      await run(db, "setting.set", { key: "timezone", value: "Europe/London" });
      await expectFail(db, "setting.set", { key: "timezone", value: "Mars/Olympus" }, "invalid_input");
      await expectFail(db, "setting.set", { key: "score.weights", value: { execution: 0.5, adherence: 0.5, focus: 0.5 } }, "invalid_input");
      await expectFail(db, "setting.set", { key: "nope", value: 1 }, "invalid_input");
      await expectFail(db, "setting.set", { key: "timezone", value: "Europe/London" }, "conflict");
    });

    it("upserts the capacity template", async () => {
      const db = await fresh();
      await run(db, "capacity.set", { weekday: 6, available_min: 0 });
      const r = await run(db, "capacity.set", { weekday: 6, available_min: 120, start_time: "10:00", end_time: "12:00" });
      expect(r.result).toEqual({ weekday: 6, available_min: 120, start_time: "10:00", end_time: "12:00" });
      await expectFail(db, "capacity.set", { weekday: 7, available_min: 10 }, "invalid_input");
      await expectFail(db, "capacity.set", { weekday: 1, available_min: 10, start_time: "12:00", end_time: "09:00" }, "invalid_input");
    });
  });

  describe("undo", () => {
    it("restores an edit, archives a creation, and records itself", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const created = await run(db, "task.create", { title: uniq("Undo me"), workstream_id: ws.id, estimate_min: 30 });
      const edited = await run(db, "task.update", { id: created.result.id, estimate_min: 90 });
      const undo1 = await run(db, "event.undo", { event_id: edited.eventIds[0] });
      expect(undo1.result.state.estimate_min).toBe(30);
      const evs = await eventsFor(db, "task", created.result.id);
      expect(evs.find((e) => e.id === edited.eventIds[0])?.undone_by).toBe(undo1.eventIds[0]);
      await expectFail(db, "event.undo", { event_id: edited.eventIds[0] }, "conflict");
      await expectFail(db, "event.undo", { event_id: created.eventIds[0] }, "conflict"); // the task changed since
      // Undo the undo, then everything back to creation.
      await run(db, "event.undo", { event_id: undo1.eventIds[0] });
      const t = await db.first<{ estimate_min: number }>("SELECT estimate_min FROM tasks WHERE id = ?", [created.result.id]);
      expect(t?.estimate_min).toBe(90);
    });

    it("archives instead of deleting when undoing a creation", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const created = await run(db, "task.create", { title: uniq("Created"), workstream_id: ws.id });
      await run(db, "event.undo", { event_id: created.eventIds[0] });
      const row = await db.first<{ archived_at: string | null }>("SELECT archived_at FROM tasks WHERE id = ?", [created.result.id]);
      expect(row?.archived_at).toBeTruthy();
    });

    it("undoes document edits as a new version", async () => {
      const db = await fresh();
      const path = `brain/${Date.now()}.md`;
      await run(db, "document.put", { path, body: "first" });
      const v2 = await run(db, "document.put", { path, body: "second" });
      const u = await run(db, "event.undo", { event_id: v2.eventIds[0] });
      expect(u.result.state).toMatchObject({ body: "first", version: 3 });
    });

    it("removes configuration and links it created", async () => {
      const db = await fresh();
      const key = "output.weekly_target";
      const existing = await db.first("SELECT 1 AS x FROM settings WHERE key = ?", [key]);
      const set = await run(db, "setting.set", { key, value: existing ? 7 : 6 });
      await run(db, "event.undo", { event_id: set.eventIds[0] });
      const ws = await makeWorkstream(db);
      const a = await makeTask(db, ws.id);
      const b = await makeTask(db, ws.id);
      const dep = await run(db, "task.add_dependency", { task_id: b.id, depends_on_id: a.id });
      await run(db, "event.undo", { event_id: dep.eventIds[0] });
      expect(await db.first("SELECT 1 AS x FROM task_dependencies WHERE task_id = ?", [b.id])).toBeNull();
      await expectFail(db, "event.undo", { event_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, "not_found");
    });
  });

  describe("seed", () => {
    it("loads the starting workstreams, capacity and brain documents once", async () => {
      const db = await empty();
      expect((await seed(db, registry)).seeded).toBe(true);
      const second = await seed(db, registry);
      expect(second.seeded).toBe(false);
      const names = (await db.all<{ name: string }>("SELECT name FROM workstreams")).map((r) => r.name);
      for (const ws of SEED_WORKSTREAMS) expect(names).toContain(ws.name);
      const sunday = await db.first<{ available_min: number }>("SELECT available_min FROM capacity_template WHERE weekday = 6");
      expect(sunday).not.toBeNull();
      const doc = await db.first("SELECT version FROM documents WHERE path = 'brain/OPERATING_RULES.md'");
      expect(doc).not.toBeNull();
    });
  });
}

/** Call last in each test file, after every suite that runs ops. */
export function coverageSuite() {
  describe("coverage", () => {
    it("exercises every registered op", () => {
      const missing = registry.list().map((o) => o.name).filter((n) => !usedOps.has(n));
      expect(missing).toEqual([]);
    });
  });
}

export type { Db };
