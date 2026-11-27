import { z } from "zod";
import type { Row, Stmt } from "../db.ts";
import { OpError, ruleViolation } from "../errors.ts";
import { ulid } from "../ids.ts";
import { defineOp, type Change, type OpContext, type OpDef } from "./registry.ts";
import { getRow, insertStmt, isEntityType, meta, normalise, updateStmt, type EntityType } from "./entities.ts";
import { id } from "./helpers.ts";

/** Columns maintained as side effects of other entities' ops; ignored when checking for newer changes. */
const DERIVED = new Set(["last_activity_at"]);

/** Compare the current row with the state an event recorded, on the columns the event recorded. */
function unchangedSince(current: Row | null, recorded: Row | null): boolean {
  if (!current || !recorded) return current === recorded;
  return Object.keys(recorded)
    .filter((k) => !DERIVED.has(k))
    .every((k) => JSON.stringify(current[k] ?? null) === JSON.stringify(recorded[k] ?? null));
}

async function currentRow(ctx: OpContext, type: EntityType, entityId: string, hint: Row | null): Promise<Row | null> {
  if (type === "task_dependency") {
    const [task_id, depends_on_id] = entityId.split(">");
    return ctx.db.first("SELECT task_id, depends_on_id FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?", [task_id, depends_on_id]);
  }
  const key = type === "capacity" ? Number(entityId) : entityId;
  void hint;
  return getRow(ctx.db, type, key);
}

function removeStmt(type: EntityType, row: Row): Stmt {
  if (type === "task_dependency") {
    return { sql: "DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?", params: [row.task_id as string, row.depends_on_id as string] };
  }
  const m = meta(type);
  return { sql: `DELETE FROM ${m.table} WHERE ${m.key} = ?`, params: [row[m.key] as string | number] };
}

interface UndoPlan {
  statements: Stmt[];
  change: Change;
  postStatement: Stmt;
  result: Record<string, unknown>;
}

async function planUndo(ctx: OpContext, eventIdToUndo: string): Promise<UndoPlan> {
  const ev = await ctx.db.first<Row>("SELECT * FROM events WHERE id = ?", [eventIdToUndo]);
  if (!ev) throw new OpError("not_found", `event ${eventIdToUndo} not found`);
  if (ev.undone_by) throw new OpError("conflict", "that change has already been undone");
  const type = ev.entity_type as string;
  if (!isEntityType(type)) throw ruleViolation("not_undoable", `changes to ${type} cannot be undone`);
  const before = ev.before_json ? (JSON.parse(ev.before_json as string) as Row) : null;
  const after = ev.after_json ? (JSON.parse(ev.after_json as string) as Row) : null;
  const entityId = ev.entity_id as string;
  const current = await currentRow(ctx, type, entityId, after);
  if (!unchangedSince(current, after)) {
    throw new OpError("conflict", "this record has changed since; undo the later changes first", { entity_type: type, entity_id: entityId });
  }

  const eventId = ulid();
  let statements: Stmt[];
  let restored: Row | null;
  const m = meta(type);

  if (before === null && current) {
    // Undo a creation.
    if (m.archivable) {
      const patch: Row = "updated_at" in current ? { archived_at: ctx.now, updated_at: ctx.now } : { archived_at: ctx.now };
      statements = [updateStmt(type, entityId, patch)];
      restored = { ...current, ...patch };
    } else {
      statements = [removeStmt(type, current)];
      restored = null;
    }
  } else if (before && current === null) {
    // Undo a removal (only links and configuration are ever removed).
    statements = [insertStmt(type, before)];
    restored = before;
  } else if (before && current) {
    if (type === "document") {
      // Restoring an earlier body is a new version, so the version history stays linear.
      const version = (current.version as number) + 1;
      const patch = normalise({ body: before.body, version, updated_at: ctx.now, updated_by: ctx.actor });
      statements = [
        updateStmt(type, entityId, patch),
        { sql: "INSERT INTO document_versions (document_id, version, body, actor, created_at) VALUES (?, ?, ?, ?, ?)", params: [entityId, version, before.body as string, ctx.actor, ctx.now] },
      ];
      restored = { ...current, ...patch };
    } else {
      const patch: Row = { ...before };
      for (const k of DERIVED) if (k in current) patch[k] = current[k];
      if ("updated_at" in patch) patch.updated_at = ctx.now;
      statements = [updateStmt(type, type === "capacity" ? Number(entityId) : entityId, patch)];
      restored = patch;
    }
  } else {
    throw new OpError("conflict", "nothing to undo");
  }

  const change: Change = { entityType: type, entityId, before: current, after: restored, eventId };
  return {
    statements,
    change,
    postStatement: { sql: "UPDATE events SET undone_by = ? WHERE id = ?", params: [eventId, eventIdToUndo] },
    result: { undone_event_id: eventIdToUndo, event_id: eventId, entity_type: type, entity_id: entityId, state: restored },
  };
}

export const undoOps: OpDef[] = [
  defineOp({
    name: "event.undo",
    tier: "A",
    description:
      "Undo recorded changes, if nothing has changed those entities since. Give event_id, or event_ids (for example every id one op returned) to undo them all at once or not at all. A created record is archived (never deleted); an edited record gets its previous values back. The undo is itself recorded.",
    input: z
      .object({ event_id: id.optional(), event_ids: z.array(id).min(1).max(50).optional() })
      .strict()
      .refine((v) => (v.event_id === undefined) !== (v.event_ids === undefined), "give event_id or event_ids, not both"),
    async plan(ctx, input) {
      const ids = input.event_ids ?? [input.event_id!];
      if (new Set(ids).size !== ids.length) throw new OpError("invalid_input", "event_ids has duplicates");
      const plans: UndoPlan[] = [];
      for (const eventId of [...ids].sort().reverse()) plans.push(await planUndo(ctx, eventId));
      const keys = plans.map((p) => `${p.change.entityType}:${p.change.entityId}`);
      if (new Set(keys).size !== keys.length) {
        throw new OpError("invalid_input", "these events change the same record; undo them one at a time, latest first");
      }
      return {
        statements: plans.flatMap((p) => p.statements),
        changes: plans.map((p) => p.change),
        postStatements: plans.map((p) => p.postStatement),
        result: input.event_ids ? { undone: plans.map((p) => p.result) } : plans[0].result,
      };
    },
  }),
] as OpDef[];
