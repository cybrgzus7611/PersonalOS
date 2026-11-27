import { describe, expect, it } from "vitest";
import { exportAll, importAll, tableToCsv } from "../../src/services/export.ts";
import { search } from "../../src/services/search.ts";
import { makeProject, makeTask, makeWorkstream, run, uniq, type Fresh } from "./fixtures.ts";

/** `source` returns a database to export from; `empty` must return a migrated database with no rows. */
export function exportSuite(source: Fresh, empty: Fresh) {
  describe("export and restore", () => {
    it("round-trips every table, including undone events, into an empty database", async () => {
      const src = await source();
      const ws = await makeWorkstream(src);
      const p = await makeProject(src, ws.id);
      const parent = await makeTask(src, ws.id, { project_id: p.id, title: `Restorable ${uniq("parent")}` });
      await makeTask(src, ws.id, { parent_task_id: parent.id, notes: 'Comma, "quote"\nnew line' });
      const edit = await run(src, "task.update", { id: parent.id, estimate_min: 25 });
      await run(src, "event.undo", { event_id: edit.eventIds[0] });
      await run(src, "document.put", { path: `brain/${Date.now()}.md`, body: "# Brain" });
      await run(src, "decision.log", { title: "Keep the stack minimal" });

      const first = await exportAll(src, "2026-11-27T00:00:00.000Z");
      const target = await empty();
      const counts = await importAll(target, first);
      expect(counts.events).toBe(first.tables.events.length);
      const second = await exportAll(target, "2026-11-27T00:00:00.000Z");
      expect(second).toEqual(first);
      expect((await search(target, "Restorable")).map((h) => h.entity_id)).toContain(parent.id);
      await expect(importAll(target, first)).rejects.toMatchObject({ code: "conflict" });
      await expect(importAll(target, { ...first, schema_version: 99 })).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("writes RFC 4180 CSV with quoting", async () => {
      const db = await source();
      const ws = await makeWorkstream(db);
      await makeTask(db, ws.id, { title: uniq("CSV"), notes: 'a, "b"\nc' });
      const csv = await tableToCsv(db, "tasks");
      expect(csv).toContain('"a, ""b""\nc"');
      expect(csv.endsWith("\r\n")).toBe(true);
    });
  });
}
