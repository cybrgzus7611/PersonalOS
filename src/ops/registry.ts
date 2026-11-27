import { z } from "zod";
import type { Db, Row, Stmt } from "../db.ts";
import { OpError } from "../errors.ts";
import { ulid } from "../ids.ts";
import { localDay, nowIso } from "../time.ts";
import { meta, type EntityType } from "./entities.ts";

export type Actor = "user" | "ai" | "automation" | "agent" | "system";

/**
 * Risk tier (spec section 6). A: applied at once and undoable. B: when the caller is the AI,
 * an automation or an agent, it becomes a proposal the user confirms (enforced from milestone M5).
 */
export type Tier = "A" | "B";

export interface OpContext {
  db: Db;
  actor: Actor;
  now: string;
  day: string;
  timeZone: string;
  proposalId: string | null;
}

/** One entity changed by an op. The executor turns each into an events row. */
export interface Change {
  entityType: EntityType;
  entityId: string;
  before: Row | null;
  after: Row | null;
  /** Preassigned event id, when the op's own statements need to reference it. */
  eventId?: string;
}

export interface OpPlan<R = unknown> {
  statements: Stmt[];
  /** Statements that must run after the events rows exist (for example marking an event as undone). */
  postStatements?: Stmt[];
  changes: Change[];
  result: R;
}

export interface OpDef<S extends z.ZodType = z.ZodType, R = unknown> {
  name: string;
  tier: Tier;
  description: string;
  input: S;
  plan(ctx: OpContext, input: z.output<S>): Promise<OpPlan<R>>;
}

export function defineOp<S extends z.ZodType, R>(def: OpDef<S, R>): OpDef<S, R> {
  return def;
}

export interface OpOutcome<R = unknown> {
  op: string;
  result: R;
  eventIds: string[];
}

export interface RunOptions {
  actor?: Actor;
  proposalId?: string | null;
  timeZone?: string;
  now?: string;
}

function eventStmt(ctx: OpContext, opName: string, change: Change, id: string): Stmt {
  return {
    sql: `INSERT INTO events (id, at, day, actor, op, entity_type, entity_id, before_json, after_json, proposal_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      id,
      ctx.now,
      ctx.day,
      ctx.actor,
      opName,
      change.entityType,
      change.entityId,
      change.before ? JSON.stringify(change.before) : null,
      change.after ? JSON.stringify(change.after) : null,
      ctx.proposalId,
    ],
  };
}

/** Keep the FTS5 search table in step with the entity's latest state. */
function searchStmts(change: Change): Stmt[] {
  const m = meta(change.entityType);
  if (!m.searchBody) return [];
  const stmts: Stmt[] = [
    { sql: "DELETE FROM search WHERE entity_type = ? AND entity_id = ?", params: [change.entityType, change.entityId] },
  ];
  const row = change.after;
  if (row && !row.archived_at) {
    stmts.push({
      sql: "INSERT INTO search (entity_type, entity_id, day, body) VALUES (?, ?, ?, ?)",
      params: [change.entityType, change.entityId, m.searchDay?.(row) ?? null, m.searchBody(row)],
    });
  }
  return stmts;
}

export class OpRegistry {
  private readonly ops = new Map<string, OpDef>();

  register(...defs: OpDef<any, any>[]): this {
    for (const def of defs) {
      if (this.ops.has(def.name)) throw new Error(`duplicate op ${def.name}`);
      this.ops.set(def.name, def as OpDef);
    }
    return this;
  }

  get(name: string): OpDef | undefined {
    return this.ops.get(name);
  }

  list(): { name: string; tier: Tier; description: string; input: unknown }[] {
    return [...this.ops.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ name: d.name, tier: d.tier, description: d.description, input: z.toJSONSchema(d.input) }));
  }

  /**
   * Validate, plan and apply one op. Entity changes, their events and search updates are sent as
   * a single batch, so either everything lands or nothing does.
   */
  async run<R = unknown>(db: Db, name: string, rawInput: unknown, opts: RunOptions = {}): Promise<OpOutcome<R>> {
    const def = this.ops.get(name);
    if (!def) throw new OpError("unknown_op", `unknown op ${name}`);
    const parsed = def.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new OpError("invalid_input", `invalid input for ${name}`, z.flattenError(parsed.error as z.ZodError));
    }
    const timeZone = opts.timeZone ?? "UTC";
    const now = opts.now ?? nowIso();
    const ctx: OpContext = {
      db,
      actor: opts.actor ?? "user",
      now,
      day: localDay(timeZone, new Date(now)),
      timeZone,
      proposalId: opts.proposalId ?? null,
    };
    const plan = await def.plan(ctx, parsed.data);
    const eventIds: string[] = [];
    const tail: Stmt[] = [];
    for (const change of plan.changes) {
      const id = change.eventId ?? ulid();
      eventIds.push(id);
      tail.push(eventStmt(ctx, name, change, id), ...searchStmts(change));
    }
    const batch = [...plan.statements, ...tail, ...(plan.postStatements ?? [])];
    // An op may find nothing to change (a repeated save): it then returns its result with no events.
    if (batch.length) await db.batch(batch);
    return { op: name, result: plan.result as R, eventIds };
  }
}
