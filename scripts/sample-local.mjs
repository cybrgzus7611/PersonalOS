// Load a realistic sample week into the LOCAL dev database, through the real API and ops
// (no mock backend). For the M2 design playground and manual testing. Run `npm run dev` and
// `npm run seed:local` first. Usage: npm run sample:local  (refuses to run twice).
// The content is invented and generic: no personal data.
const base = process.env.POS_URL ?? "http://localhost:8787";

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} failed (${res.status}): ${json?.error?.message ?? JSON.stringify(json)}`);
  return json;
}
const op = (name, input) => call("POST", `/api/ops/${name}`, input).then((r) => r.result);

const health = await call("GET", "/api/health").catch(() => null);
if (!health) {
  console.error(`No dev server at ${base}. Start it with npm run dev.`);
  process.exit(1);
}
const projects = (await call("GET", "/api/entities/project?include_archived=1")).items;
if (projects.some((p) => p.slug.startsWith("sample-"))) {
  console.log("Sample data is already loaded; nothing changed. (Delete .wrangler/state to start again.)");
  process.exit(0);
}
const ws = (await call("GET", "/api/entities/workstream")).items;
if (ws.length < 5) {
  console.error("Run npm run seed:local first.");
  process.exit(1);
}
const lane = (prefix) => ws.find((w) => w.name.startsWith(prefix)).id;
const PROD = lane("Production"), BIZ = lane("Business"), CLIENT = lane("Client"), AI = lane("AI"), ADMIN = lane("Personal");

const { week } = await call("GET", "/api/today");
const { days } = await call("GET", `/api/week/${week}`);
const d = days.map((x) => x.day); // Monday .. Sunday of this week

const p = {};
for (const [key, title, workstream_id, extra] of [
  ["shop", "Template shop launch", PROD, { priority: 1, due_day: d[4] }],
  ["portfolio", "Portfolio refresh", PROD, { priority: 3 }],
  ["pipeline", "Q1 client pipeline", BIZ, { priority: 2 }],
  ["retainer", "Retainer: brand guidelines", CLIENT, { priority: 1 }],
  ["bench", "Local model benchmark", AI, { priority: 4 }],
]) {
  p[key] = await op("project.create", { title, workstream_id, slug: `sample-${key}`, ...extra });
}

const tasks = [
  // Monday
  ["Draft SOP template structure", PROD, "shop", d[0], 90, { is_priority: true }],
  ["Follow up two warm leads", BIZ, "pipeline", d[0], 45, { is_priority: true }],
  ["Brand colour audit", CLIENT, "retainer", d[0], 60],
  ["Pay quarterly invoice", ADMIN, null, d[0], 15],
  // Tuesday (deliberately overloaded)
  ["Write sales page copy", PROD, "shop", d[1], 180, { is_priority: true, is_deliverable: true }],
  ["Edit portfolio case study", PROD, "portfolio", d[1], 120],
  ["Guidelines: typography section", CLIENT, "retainer", d[1], 150],
  // Wednesday
  ["Record walkthrough video", PROD, "shop", d[2], 60],
  ["Outline newsletter", BIZ, null, d[2], 30],
  ["Run benchmark set A", AI, "bench", d[2], null],
  // Thursday
  ["Guidelines: logo usage pages", CLIENT, "retainer", d[3], 120, { is_priority: true }],
  ["Discovery call prep", BIZ, "pipeline", d[3], 30],
  // Friday
  ["Publish template shop", PROD, "shop", d[4], 60, { is_priority: true, is_deliverable: true }],
  ["Weekly admin sweep", ADMIN, null, d[4], 30],
  // Saturday (light)
  ["Sketch portfolio layout", PROD, "portfolio", d[5], 60],
  // Backlog
  ["Price research for templates", BIZ, "pipeline", null, 45],
  ["Compare embedding models", AI, "bench", null, null],
  ["Sort receipts", ADMIN, null, null, 20, { status: "backlog" }],
];
const made = [];
for (const [title, workstream_id, proj, planned_day, estimate_min, extra = {}] of tasks) {
  made.push(
    await op("task.create", {
      title, workstream_id,
      ...(proj && { project_id: p[proj].id }),
      ...(planned_day && { planned_day }),
      ...(estimate_min && { estimate_min }),
      ...extra,
    }),
  );
}
await op("task.complete", { id: made[3].id });
await op("task.complete", { id: made[1].id });
await op("day.set", { day: d[5], day_type: "light", available_min: 180 });
await op("weekly_outcome.set", { week, position: 1, title: "Launch the template shop", project_id: p.shop.id });
await op("weekly_outcome.set", { week, position: 2, title: "Deliver guidelines draft to the client", project_id: p.retainer.id });
await op("weekly_outcome.set", { week, position: 3, title: "Book two discovery calls", project_id: p.pipeline.id });
await op("day.commit", { day: d[0] });
await op("idea.capture", { title: "Mini course built from the SOP templates", kind: "possible_project" });
await op("decision.log", { title: "Price templates at a single tier for launch", project_id: p.shop.id, rationale: "Simpler checkout; revisit after 30 sales" });

console.log(`Loaded a sample week for ${week}: ${Object.keys(p).length} projects, ${made.length} tasks, 3 outcomes, Monday committed.`);
