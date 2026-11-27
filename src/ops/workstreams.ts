import { z } from "zod";
import { OpError } from "../errors.ts";
import { defineOp, type OpDef } from "./registry.ts";
import { archiveOps, defined, id, loadEditable, planCreate, planPatch, requireSomeField } from "./helpers.ts";

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a hex colour like #4f8cff");
const fields = {
  name: z.string().trim().min(1).max(80),
  colour,
  daily_target_min: z.number().int().min(0).max(1440),
  is_core: z.boolean(),
  sort_order: z.number().int(),
};

async function assertNameFree(db: import("../db.ts").Db, name: string, exceptId?: string) {
  const clash = await db.first<{ id: string }>("SELECT id FROM workstreams WHERE lower(name) = lower(?)", [name]);
  if (clash && clash.id !== exceptId) throw new OpError("duplicate", `a workstream called "${name}" already exists`);
}

export const workstreamOps: OpDef[] = [
  defineOp({
    name: "workstream.create",
    tier: "B",
    description: "Create a workstream (a swimlane such as Production or Client delivery).",
    input: z
      .object({
        name: fields.name,
        colour: colour.default("#7c8aa5"),
        daily_target_min: fields.daily_target_min.default(0),
        is_core: fields.is_core.default(false),
        sort_order: fields.sort_order.optional(),
      })
      .strict(),
    async plan(ctx, input) {
      await assertNameFree(ctx.db, input.name);
      const max = await ctx.db.first<{ m: number | null }>("SELECT max(sort_order) AS m FROM workstreams");
      return planCreate(ctx, "workstream", { ...input, sort_order: input.sort_order ?? (max?.m ?? 0) + 10 });
    },
  }),
  defineOp({
    name: "workstream.update",
    tier: "B",
    description: "Rename a workstream or change its colour, daily target, core flag or order.",
    input: z
      .object({
        id,
        name: fields.name.optional(),
        colour: colour.optional(),
        daily_target_min: fields.daily_target_min.optional(),
        is_core: fields.is_core.optional(),
        sort_order: fields.sort_order.optional(),
      })
      .strict(),
    async plan(ctx, input) {
      requireSomeField(input);
      const before = await loadEditable(ctx, "workstream", input.id);
      if (input.name) await assertNameFree(ctx.db, input.name, input.id);
      const { id: _id, ...patch } = input;
      return planPatch(ctx, "workstream", before, defined(patch));
    },
  }),
  ...archiveOps("workstream", "B"),
] as OpDef[];
