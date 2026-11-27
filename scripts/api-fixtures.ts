// Regenerate the API fixtures in test/fixtures/api/ from the real app on an in-memory database.
// Usage: npm run fixtures:api. The data is synthetic (seed workstreams plus sample tasks); no personal data.
import { mkdirSync, writeFileSync } from "node:fs";
import { SqliteDb } from "../src/platform/node.ts";
import { createApp } from "../src/api/app.ts";
import { registry } from "../src/ops/index.ts";
import { seed } from "../src/seed.ts";

const OUT = "test/fixtures/api";
const WEEK = "2026-W49";
const MON = "2026-11-30";
const TUE = "2026-12-01";
const WED = "2026-12-02";

const db = new SqliteDb(":memory:");
db.migrate("migrations");
await seed(db, registry);
const app = createApp({ getDb: () => db, isDev: () => true });

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function op(name: string, input: unknown) {
  const r = await call("POST", `/api/ops/${name}`, input);
  if (r.status !== 200) throw new Error(`${name} failed: ${JSON.stringify(r.body)}`);
  return r.body;
}

const ws = (await call("GET", "/api/entities/workstream")).body.items as { id: string; name: string }[];
const byName = (prefix: string) => ws.find((w) => w.name.startsWith(prefix))!.id;
const prod = byName("Production");
const biz = byName("Business");
const ai = byName("AI");
const admin = byName("Personal");

const files: Record<string, unknown> = {};
const project = (await op("project.create", { title: "Template shop launch", workstream_id: prod })).result;
files["op-task-create.json"] = await op("task.create", { title: "Draft SOP template", workstream_id: prod, project_id: project.id, estimate_min: 90, planned_day: MON, is_priority: true });
await op("task.create", { title: "Record walkthrough video", workstream_id: prod, project_id: project.id, estimate_min: 60, planned_day: MON });
await op("task.create", { title: "Follow up with two leads", workstream_id: biz, estimate_min: 45, planned_day: MON, is_priority: true });
await op("task.create", { title: "Benchmark local model", workstream_id: ai, planned_day: MON });
await op("task.create", { title: "Pay quarterly bill", workstream_id: admin, estimate_min: 15, planned_day: MON });
await op("task.create", { title: "Write sales page", workstream_id: prod, project_id: project.id, estimate_min: 240, planned_day: TUE, is_deliverable: true });
await op("task.create", { title: "Edit portfolio shots", workstream_id: prod, estimate_min: 200, planned_day: TUE });
await op("task.create", { title: "Outline newsletter", workstream_id: biz, estimate_min: 30, planned_day: WED });
await op("task.create", { title: "Sort receipts", workstream_id: admin, status: "backlog" });
await op("task.create", { title: "Price research", workstream_id: biz, due_day: "2026-12-04" });
await op("day.set", { day: "2026-12-04", available_min: 240 });
await op("day.set", { day: "2026-12-05", day_type: "leave" });
files["op-weekly-outcome-set.json"] = await op("weekly_outcome.set", { week: WEEK, position: 1, title: "Launch the template shop", project_id: project.id });
await op("weekly_outcome.set", { week: WEEK, position: 2, title: "Book two discovery calls" });
files["op-day-commit.json"] = await op("day.commit", { day: MON });

files["day.json"] = (await call("GET", `/api/day/${MON}`)).body;
files["week.json"] = (await call("GET", `/api/week/${WEEK}`)).body;
files["quickadd-parse.json"] = (await call("POST", "/api/quickadd/parse", { text: "prod: SOP checklist 45m tue !", today: "2026-11-27" })).body;
files["quickadd-parse-warnings.json"] = (await call("POST", "/api/quickadd/parse", { text: "p: Call about 2h slot", today: "2026-11-27" })).body;
files["error-priority-cap.json"] = (
  await call("POST", "/api/ops/task.create", { title: "A fourth priority", workstream_id: ai, planned_day: MON, is_priority: true }).then(async (r) => {
    if (r.status === 200) return call("POST", "/api/ops/task.create", { title: "A fifth priority", workstream_id: ai, planned_day: MON, is_priority: true });
    return r;
  })
).body;
files["error-duplicate.json"] = (await call("POST", "/api/ops/task.create", { title: "Draft SOP template", workstream_id: prod, project_id: project.id })).body;

mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(files)) writeFileSync(`${OUT}/${name}`, JSON.stringify(body, null, 2) + "\n");
db.close();
console.log(`Wrote ${Object.keys(files).length} fixtures to ${OUT}/`);
