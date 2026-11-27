import { describe, expect, it } from "vitest";
import { addDays, daysOfIsoWeek, isoWeekOf, isRealDay, weekdayOf } from "../../src/services/calendar.ts";
import { dayView, loadOf, weekView } from "../../src/services/planning.ts";
import { matchWorkstream, parseDay, parseEstimate, parseQuickAdd } from "../../src/services/quickadd.ts";
import { eventsFor, expectFail, makeProject, makeTask, makeWorkstream, run, uniq, uniqDay, type Fresh } from "./fixtures.ts";

/** A far-future ISO week no other test uses. */
function uniqWeek(): string {
  return isoWeekOf(uniqDay());
}

export function planningSuite(fresh: Fresh) {
  describe("calendar", () => {
    it("handles ISO weeks, weekdays and real dates", () => {
      expect(isoWeekOf("2026-11-27")).toBe("2026-W48");
      expect(isoWeekOf("2027-01-01")).toBe("2026-W53");
      expect(isoWeekOf("2024-12-30")).toBe("2025-W01");
      expect(daysOfIsoWeek("2026-W48")).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
      expect(daysOfIsoWeek("2026-W53")?.[0]).toBe("2026-12-28");
      expect(daysOfIsoWeek("2025-W53")).toBeNull();
      expect(daysOfIsoWeek("2026-W00")).toBeNull();
      expect(weekdayOf("2026-11-23")).toBe(0);
      expect(weekdayOf("2026-11-29")).toBe(6);
      expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
      expect(isRealDay("2026-02-29")).toBe(false);
      expect(isRealDay("2028-02-29")).toBe(true);
    });

    it("applies the load rule", () => {
      expect(loadOf(0, 0)).toBe("ok");
      expect(loadOf(30, 0)).toBe("over");
      expect(loadOf(378, 420)).toBe("ok");
      expect(loadOf(379, 420)).toBe("high");
      expect(loadOf(420, 420)).toBe("high");
      expect(loadOf(421, 420)).toBe("over");
    });
  });

  describe("day ops", () => {
    it("overrides capacity and day type, and undo returns the day to its template", async () => {
      const db = await fresh();
      const day = uniqDay();
      await run(db, "capacity.set", { weekday: weekdayOf(day), available_min: 400 });
      const set = await run(db, "day.set", { day, available_min: 180 });
      expect(set.result).toMatchObject({ day, available_min: 180, day_type: "work" });
      let view = await dayView(db, day);
      expect(view.capacity).toMatchObject({ available_min: 180, configured_min: 180, source: "override" });

      await run(db, "day.set", { day, day_type: "leave" });
      view = await dayView(db, day);
      expect(view.capacity).toMatchObject({ available_min: 0, configured_min: 180, day_type: "leave" });
      expect((await eventsFor(db, "day", day)).length).toBe(2);

      await expectFail(db, "day.set", { day, day_type: "leave" }, "conflict");
      await expectFail(db, "day.set", { day }, "invalid_input");
      await expectFail(db, "day.set", { day: "2026-02-30", available_min: 10 }, "invalid_input");
      await expectFail(db, "day.set", { day, available_min: 2000 }, "invalid_input");

      const events = await eventsFor(db, "day", day);
      await run(db, "event.undo", { event_id: events[1].id });
      await run(db, "event.undo", { event_id: events[0].id });
      view = await dayView(db, day);
      expect(view.capacity).toMatchObject({ available_min: 400, source: "template", day_type: "work" });
    });

    it("commits a snapshot of the plan once, and uncommits before any submission", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const day = uniqDay();
      await expectFail(db, "day.commit", { day }, "rule_violation");
      const a = await makeTask(db, ws.id, { planned_day: day, estimate_min: 60, is_priority: true });
      const b = await makeTask(db, ws.id, { planned_day: day });
      await makeTask(db, ws.id, { planned_day: day, status: "backlog" });

      const c = await run(db, "day.commit", { day });
      expect(c.result.committed_at).toBeTruthy();
      expect(c.result.plan_snapshot.priorities).toEqual([a.id]);
      expect(c.result.plan_snapshot.tasks.map((t: any) => t.id).sort()).toEqual([a.id, b.id].sort());
      const stored = await db.first<{ plan_snapshot: string }>("SELECT plan_snapshot FROM days WHERE day = ?", [day]);
      expect(JSON.parse(stored!.plan_snapshot).tasks).toHaveLength(2);
      expect((await dayView(db, day)).committed_at).toBe(c.result.committed_at);
      expect((await dayView(db, day)).capacity.source).toBe("template");

      await expectFail(db, "day.commit", { day }, "conflict");
      const u = await run(db, "day.uncommit", { day });
      expect(u.result).toMatchObject({ committed_at: null, plan_snapshot: null });
      await expectFail(db, "day.uncommit", { day }, "conflict");
      await expectFail(db, "day.uncommit", { day: uniqDay() }, "conflict");
    });
  });

  describe("weekly outcome ops", () => {
    it("sets, replaces, scores and clears outcome slots without deleting", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const project = await makeProject(db, ws.id);
      const week = uniqWeek();
      const first = await run(db, "weekly_outcome.set", { week, position: 1, title: uniq("Outcome"), project_id: project.id });
      expect(first.result).toMatchObject({ week, position: 1, status: "open", project_id: project.id });
      const replaced = await run(db, "weekly_outcome.set", { week, position: 1, title: "Ship the SOP template" });
      expect(replaced.result.id).toBe(first.result.id);
      expect(replaced.result).toMatchObject({ title: "Ship the SOP template", project_id: project.id });
      const cleared = await run(db, "weekly_outcome.set", { week, position: 1, title: "Ship the SOP template", project_id: null });
      expect(cleared.result.project_id).toBeNull();

      await expectFail(db, "weekly_outcome.set", { week, position: 4, title: "x" }, "invalid_input");
      await expectFail(db, "weekly_outcome.set", { week: "2026-W54", position: 1, title: "x" }, "invalid_input");
      await expectFail(db, "weekly_outcome.set", { week, position: 2, title: "x", project_id: "01ARZ3NDEKTSV4RRFFQ69G5FAV" }, "invalid_input");

      const second = await run(db, "weekly_outcome.set", { week, position: 2, title: uniq("Outcome") });
      await run(db, "weekly_outcome.set_status", { id: first.result.id, status: "met" });
      await expectFail(db, "weekly_outcome.set_status", { id: first.result.id, status: "met" }, "conflict");
      await expectFail(db, "weekly_outcome.clear", { id: first.result.id }, "rule_violation");

      const gone = await run(db, "weekly_outcome.clear", { id: second.result.id });
      expect(gone.result.archived_at).toBeTruthy();
      expect(await db.first("SELECT id FROM weekly_outcomes WHERE id = ?", [second.result.id])).not.toBeNull();
      await expectFail(db, "weekly_outcome.clear", { id: second.result.id }, "not_found");
      await expectFail(db, "weekly_outcome.set_status", { id: second.result.id, status: "met" }, "not_found");

      // The freed slot can be filled again.
      const refill = await run(db, "weekly_outcome.set", { week, position: 2, title: uniq("Outcome") });
      expect(refill.result.id).not.toBe(second.result.id);
      const view = await weekView(db, week);
      expect(view.outcomes.map((o) => o.position)).toEqual([1, 2]);

      // Undoing a creation archives the outcome.
      await run(db, "event.undo", { event_id: refill.eventIds[0] });
      expect((await weekView(db, week)).outcomes.map((o) => o.position)).toEqual([1]);
    });
  });

  describe("day and week views", () => {
    it("groups the day by workstream and computes the load", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db, { daily_target_min: 60 });
      const other = await makeWorkstream(db);
      const day = uniqDay();
      await run(db, "day.set", { day, available_min: 200 });
      const p = await makeTask(db, ws.id, { planned_day: day, estimate_min: 90, is_priority: true });
      const n = await makeTask(db, ws.id, { planned_day: day }); // no estimate: counts 30
      const d = await makeTask(db, other.id, { planned_day: day, estimate_min: 45 });
      await run(db, "task.complete", { id: d.id });
      const dropped = await makeTask(db, other.id, { planned_day: day, estimate_min: 500 });
      await run(db, "task.update", { id: dropped.id, status: "dropped" });

      const v = await dayView(db, day);
      expect(v.planned_min).toBe(165);
      expect(v.remaining_min).toBe(120);
      expect(v.unestimated_count).toBe(1);
      expect(v.load).toBe("ok");
      expect(v.priorities.map((t) => t.id)).toEqual([p.id]);
      const lane = v.tasks_by_workstream.find((l) => l.workstream.id === ws.id)!;
      expect(lane.tasks.map((t) => t.id)).toEqual([p.id, n.id]);
      expect(lane.planned_min).toBe(120);
      expect(v.tasks_by_workstream.find((l) => l.workstream.id === other.id)!.tasks.map((t) => t.id)).toEqual([d.id]);

      await makeTask(db, ws.id, { planned_day: day, estimate_min: 20 });
      expect((await dayView(db, day)).load).toBe("high");
      await makeTask(db, ws.id, { planned_day: day, estimate_min: 20 });
      expect((await dayView(db, day)).load).toBe("over");
      await expect(dayView(db, "2026-13-01")).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("builds the swimlane week with cells, targets, backlog and outcomes", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db, { daily_target_min: 60 });
      const week = uniqWeek();
      const days = daysOfIsoWeek(week)!;
      const mon = await makeTask(db, ws.id, { planned_day: days[0], estimate_min: 60 });
      const wed = await makeTask(db, ws.id, { planned_day: days[2], estimate_min: 30 });
      await run(db, "day.set", { day: days[4], available_min: 0 });
      await makeTask(db, ws.id, { planned_day: days[4], estimate_min: 15 });
      const loose = await makeTask(db, ws.id, { is_priority: false });
      await run(db, "weekly_outcome.set", { week, position: 3, title: uniq("Outcome") });

      const v = await weekView(db, week);
      expect(v.days).toHaveLength(7);
      expect(v.days.map((d) => d.day)).toEqual(days);
      expect(v.days[6].is_planning_day).toBe(false);
      expect(v.days[4]).toMatchObject({ available_min: 0, planned_min: 15, load: "over" });
      const lane = v.workstreams.find((w) => w.id === ws.id)!;
      expect(Object.keys(lane.cells)).toEqual(days);
      expect(lane.cells[days[0]].map((t) => t.id)).toEqual([mon.id]);
      expect(lane.cells[days[2]].map((t) => t.id)).toEqual([wed.id]);
      expect(lane.planned_min).toBe(105);
      expect(lane.weekly_target_min).toBe(360);
      expect(v.backlog.map((t) => t.id)).toContain(loose.id);
      expect(v.backlog.every((t) => t.planned_day === null)).toBe(true);
      expect(v.outcomes).toHaveLength(1);
      expect(v.previous_week).toBe(isoWeekOf(addDays(days[0], -1)));
      expect(v.next_week).toBe(isoWeekOf(addDays(days[6], 1)));
      await expect(weekView(db, "2026-W60")).rejects.toMatchObject({ code: "invalid_input" });

      // Archived workstreams stay visible only while they still hold tasks in view.
      const gone = await makeWorkstream(db);
      await run(db, "workstream.archive", { id: gone.id });
      expect((await weekView(db, week)).workstreams.some((w) => w.id === gone.id)).toBe(false);
    });
  });
}

export function quickAddSuite(fresh: Fresh) {
  describe("quick-add parser", () => {
    it("parses estimates, days and aliases", () => {
      expect(parseEstimate("45m")).toBe(45);
      expect(parseEstimate("45min")).toBe(45);
      expect(parseEstimate("2h")).toBe(120);
      expect(parseEstimate("1.5h")).toBe(90);
      expect(parseEstimate("1h30m")).toBe(90);
      expect(parseEstimate("1h30")).toBe(90);
      expect(parseEstimate("45")).toBeNull();
      expect(parseEstimate("h")).toBeNull();

      // 2026-11-27 is a Friday.
      expect(parseDay("today", "2026-11-27")).toBe("2026-11-27");
      expect(parseDay("tmr", "2026-11-27")).toBe("2026-11-28");
      expect(parseDay("fri", "2026-11-27")).toBe("2026-11-27");
      expect(parseDay("tue", "2026-11-27")).toBe("2026-12-01");
      expect(parseDay("Monday", "2026-11-27")).toBe("2026-11-30");
      expect(parseDay("2026-12-24", "2026-11-27")).toBe("2026-12-24");
      expect(parseDay("2026-02-30", "2026-11-27")).toBeNull();
      expect(parseDay("tuesdays", "2026-11-27")).toBeNull();

      const seeded = [
        { name: "Business development" },
        { name: "Production and creative practice" },
        { name: "Client delivery" },
        { name: "AI infrastructure and research" },
        { name: "Personal administration" },
      ];
      expect(matchWorkstream("prod", seeded).map((w) => w.name)).toEqual(["Production and creative practice"]);
      expect(matchWorkstream("bd", seeded).map((w) => w.name)).toEqual(["Business development"]);
      expect(matchWorkstream("ai", seeded).map((w) => w.name)).toEqual(["AI infrastructure and research"]);
      expect(matchWorkstream("admin", seeded).map((w) => w.name)).toEqual(["Personal administration"]);
      expect(matchWorkstream("client", seeded).map((w) => w.name)).toEqual(["Client delivery"]);
      expect(matchWorkstream("p", seeded)).toHaveLength(2);
      expect(matchWorkstream("zzz", seeded)).toHaveLength(0);
    });

    it("turns a line into a task.create input that saves as is", async () => {
      const db = await fresh();
      const ws = await makeWorkstream(db);
      const alias = (ws.name as string).split(" ")[1];
      const title = uniq("SOP template");
      const r = await parseQuickAdd(db, `${alias}: ${title} 45m tue !`, "2026-11-27");
      expect(r.warnings).toEqual([]);
      expect(r.workstream?.id).toBe(ws.id);
      expect(r.input).toEqual({ title, workstream_id: ws.id, estimate_min: 45, planned_day: "2026-12-01", is_priority: true, source: "quick_add" });
      const saved = await run(db, "task.create", r.input);
      expect(saved.result).toMatchObject({ title, source: "quick_add", estimate_min: 45, is_priority: 1 });

      // Modifiers are read from the end only; a lone word stays the title.
      const mid = await parseQuickAdd(db, `${alias}: Call tue about 2h slot *`, "2026-11-27");
      expect(mid.input).toMatchObject({ title: "Call tue about 2h slot", is_deliverable: true });
      expect(mid.warnings).toContain("no estimate; it will count as 30 minutes in the plan");
      const lone = await parseQuickAdd(db, `${alias}: tue`, "2026-11-27");
      expect(lone.input.title).toBe("tue");

      const none = await parseQuickAdd(db, "Write invoice 30m", "2026-11-27");
      expect(none.input.workstream_id).toBeUndefined();
      expect(none.warnings[0]).toMatch(/no workstream/);
      const unknown = await parseQuickAdd(db, "qqqqzzzz: Write invoice 30m 2020-01-01", "2026-11-27");
      expect(unknown.warnings).toEqual(['no workstream matches "qqqqzzzz"', "2020-01-01 is in the past"]);
      const big = await parseQuickAdd(db, `${alias}: Long job 30h`, "2026-11-27");
      expect(big.input.estimate_min).toBeUndefined();
      expect(big.warnings.some((w) => w.startsWith("estimate 30h ignored"))).toBe(true);
      const empty = await parseQuickAdd(db, `${alias}: `, "2026-11-27");
      expect(empty.warnings).toContain("the task needs a title");
    });
  });
}
