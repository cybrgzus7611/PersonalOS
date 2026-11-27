import { z } from "zod";
import type { Row } from "../db.ts";
import { OpError } from "../errors.ts";
import { ulid } from "../ids.ts";
import { DAY_RE } from "../time.ts";
import { defineOp, type OpContext, type OpDef, type OpPlan, type Tier } from "./registry.ts";
import { columnDefaults, insertStmt, normalise, requireRow, updateStmt, type EntityType } from "./entities.ts";

export const id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "must be a ULID");
export const day = z.string().regex(DAY_RE, "must be YYYY-MM-DD");
export const title = z.string().trim().min(1).max(300);
export const text = z.string().max(20_000);
export const flag = z.boolean();

/** Remove keys whose value is undefined so they do not overwrite columns. */
export function defined(obj: Record<string, unknown>): Row {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

export async function planCreate(ctx: OpContext, type: EntityType, fields: Row): Promise<OpPlan<Row>> {
  const defaults = await columnDefaults(ctx.db, type);
  const row = normalise({ ...defaults, id: ulid(), ...fields, created_at: ctx.now, updated_at: ctx.now });
  return { statements: [insertStmt(type, row)], changes: [{ entityType: type, entityId: row.id as string, before: null, after: row }], result: row };
}

export async function loadEditable(ctx: OpContext, type: EntityType, rowId: string): Promise<Row> {
  const row = await requireRow(ctx.db, type, rowId);
  if (row.archived_at) throw new OpError("rule_violation", `${type} ${rowId} is archived; unarchive it first`);
  return row;
}

export function planPatch(ctx: OpContext, type: EntityType, before: Row, patch: Row): OpPlan<Row> {
  const full = normalise({ ...patch, updated_at: ctx.now });
  const after = { ...before, ...full };
  return {
    statements: [updateStmt(type, before.id as string, full)],
    changes: [{ entityType: type, entityId: before.id as string, before, after }],
    result: after,
  };
}

/** Archive and unarchive ops for an archivable entity. */
export function archiveOps(type: EntityType, tier: Tier = "A"): OpDef[] {
  return [
    defineOp({
      name: `${type}.archive`,
      tier,
      description: `Archive a ${type}. Nothing is deleted; it is hidden from active lists.`,
      input: z.object({ id }).strict(),
      async plan(ctx, input) {
        const before = await requireRow(ctx.db, type, input.id);
        if (before.archived_at) throw new OpError("conflict", `${type} ${input.id} is already archived`);
        return planPatch(ctx, type, before, { archived_at: ctx.now });
      },
    }),
    defineOp({
      name: `${type}.unarchive`,
      tier,
      description: `Restore an archived ${type}.`,
      input: z.object({ id }).strict(),
      async plan(ctx, input) {
        const before = await requireRow(ctx.db, type, input.id);
        if (!before.archived_at) throw new OpError("conflict", `${type} ${input.id} is not archived`);
        return planPatch(ctx, type, before, { archived_at: null });
      },
    }),
  ] as OpDef[];
}

/** Require at least one field besides id in an update. */
export function requireSomeField(input: Record<string, unknown>): void {
  if (Object.keys(defined(input)).filter((k) => k !== "id").length === 0) {
    throw new OpError("invalid_input", "nothing to update");
  }
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "project"
  );
}
