import type { Db } from "../../src/db.ts";
import { registry } from "../../src/ops/index.ts";

let counter = 0;
/** Unique suffix so suites can share one database without clashing. */
export function uniq(label = "x"): string {
  counter += 1;
  const letters = "bcdfghjklmnpqrstvwxyz";
  let token = "";
  for (let i = 0; i < 10; i++) token += letters.charAt(Math.floor(Math.random() * letters.length));
  return `${label} ${token}${counter}`;
}

export type Fresh = () => Promise<Db>;

/** Ops exercised by the suites; the coverage test checks every registered op appears here. */
export const usedOps = new Set<string>();

export async function run<R = any>(db: Db, op: string, input: unknown, opts: Parameters<typeof registry.run>[3] = {}) {
  usedOps.add(op);
  return registry.run<R>(db, op, input, opts);
}

/** Expect an op to fail with a given error code and to leave no new events behind. */
export async function expectFail(db: Db, op: string, input: unknown, code: string) {
  usedOps.add(op);
  const before = await db.first<{ n: number }>("SELECT count(*) AS n FROM events");
  let caught: any;
  try {
    await registry.run(db, op, input);
  } catch (err) {
    caught = err;
  }
  if (!caught) throw new Error(`${op} was expected to fail with ${code} but succeeded`);
  if (caught.code !== code) throw new Error(`${op} failed with ${caught.code ?? caught.message}, expected ${code}`);
  const after = await db.first<{ n: number }>("SELECT count(*) AS n FROM events");
  if (after?.n !== before?.n) throw new Error(`${op} failed but wrote events`);
  return caught;
}

export async function makeWorkstream(db: Db, overrides: Record<string, unknown> = {}) {
  const { result } = await run(db, "workstream.create", { name: uniq("WS"), ...overrides });
  return result as Record<string, any>;
}

export async function makeProject(db: Db, workstreamId: string, overrides: Record<string, unknown> = {}) {
  const { result } = await run(db, "project.create", { title: uniq("Project"), workstream_id: workstreamId, ...overrides });
  return result as Record<string, any>;
}

export async function makeTask(db: Db, workstreamId: string, overrides: Record<string, unknown> = {}) {
  const { result } = await run(db, "task.create", { title: uniq("Task"), workstream_id: workstreamId, ...overrides });
  return result as Record<string, any>;
}

export async function eventsFor(db: Db, type: string, id: string) {
  return db.all<Record<string, any>>("SELECT * FROM events WHERE entity_type = ? AND entity_id = ? ORDER BY id", [type, id]);
}

/** A day unique to this call (far future), so priority-cap tests never collide. */
let dayCounter = 0;
export function uniqDay(): string {
  dayCounter += 1;
  const d = new Date(Date.UTC(2090, 0, 1) + (Math.floor(Math.random() * 3000) * 10 + dayCounter) * 86_400_000);
  return d.toISOString().slice(0, 10);
}
