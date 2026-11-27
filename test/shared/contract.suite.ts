import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createApp } from "../../src/api/app.ts";
import { dayViewResponse, errorResponse, opResponse, projectRegisterResponse, quickAddResponse, weekViewResponse } from "../../src/api/contract.ts";
import { daysOfIsoWeek, isoWeekOf } from "../../src/services/calendar.ts";
import { makeTask, makeWorkstream, run, uniq, uniqDay, usedOps, type Fresh } from "./fixtures.ts";

function conforms(schema: z.ZodType, body: unknown) {
  const r = schema.safeParse(body);
  if (!r.success) throw new Error(`response does not match the contract:\n${JSON.stringify(r.error.issues, null, 2)}`);
}

export function contractSuite(fresh: Fresh) {
  describe("M2 API contract", () => {
    it("serves the day, week and quick-add endpoints in the documented shapes", async () => {
      const db = await fresh();
      const app = createApp({ getDb: () => db, isDev: () => true });
      const ws = await makeWorkstream(db, { daily_target_min: 90 });
      const week = isoWeekOf(uniqDay());
      const days = daysOfIsoWeek(week)!;
      await makeTask(db, ws.id, { planned_day: days[1], estimate_min: 45, is_priority: true });
      await makeTask(db, ws.id, { planned_day: days[1] });
      await makeTask(db, ws.id);
      await run(db, "weekly_outcome.set", { week, position: 1, title: uniq("Outcome") });
      await run(db, "day.commit", { day: days[1] });

      const dayRes = await app.request(`/api/day/${days[1]}`);
      expect(dayRes.status).toBe(200);
      const dayBody: any = await dayRes.json();
      conforms(dayViewResponse, dayBody);
      expect(dayBody.committed_at).not.toBeNull();

      const weekRes = await app.request(`/api/week/${week}`);
      expect(weekRes.status).toBe(200);
      const weekBody: any = await weekRes.json();
      conforms(weekViewResponse, weekBody);
      expect(weekBody.days[1].committed_at).not.toBeNull();

      const alias = (ws.name as string).split(" ")[1];
      const parse = await app.request("/api/quickadd/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `${alias}: ${uniq("Draft")} 1h wed !`, today: days[0] }),
      });
      expect(parse.status).toBe(200);
      const parsed: any = await parse.json();
      conforms(quickAddResponse, parsed);
      expect(parsed.input.planned_day).toBe(days[2]);

      const get = await app.request(`/api/quickadd/parse?text=${encodeURIComponent(`${alias}: Draft 1h wed !`)}&today=${days[0]}`);
      expect(get.status).toBe(200);
      const viaGet: any = await get.json();
      conforms(quickAddResponse, viaGet);
      expect(viaGet.input).toMatchObject({ title: "Draft", estimate_min: 60, planned_day: days[2], is_priority: true });
      expect((await app.request("/api/quickadd/parse")).status).toBe(400);

      const project = (await run(db, "project.create", { title: uniq("Register"), workstream_id: ws.id })).result;
      await makeTask(db, ws.id, { project_id: project.id, due_day: days[3] });
      const doneTask = await makeTask(db, ws.id, { project_id: project.id });
      await run(db, "task.complete", { id: doneTask.id });
      const reg = await app.request("/api/projects");
      expect(reg.status).toBe(200);
      const regBody: any = await reg.json();
      conforms(projectRegisterResponse, regBody);
      expect(regBody.items.find((p: any) => p.id === project.id)).toMatchObject({ open_task_count: 1, done_task_count: 1, next_task_due_day: days[3] });

      usedOps.add("task.create");
      const created = await app.request("/api/ops/task.create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.input),
      });
      expect(created.status).toBe(200);
      conforms(opResponse, await created.json());
    });

    it("rejects bad paths and bodies with the error envelope", async () => {
      const db = await fresh();
      const real = createApp({ getDb: () => db, isDev: () => true });
      for (const [path, init, status] of [
        ["/api/day/2026-02-30", undefined, 400],
        ["/api/week/2026-W60", undefined, 400],
        ["/api/quickadd/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, 400],
        ["/api/quickadd/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(501) }) }, 400],
        ["/api/quickadd/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "a", today: "soon" }) }, 400],
      ] as const) {
        const res = await real.request(path, init as RequestInit | undefined);
        expect(res.status).toBe(status);
        conforms(errorResponse, await res.json());
      }
    });
  });
}
