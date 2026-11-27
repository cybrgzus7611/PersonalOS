import { z } from "zod";
import type { Row } from "../db.ts";
import { OpError } from "../errors.ts";
import { isSettingKey, SETTINGS } from "../settings.ts";
import { TIME_RE } from "../time.ts";
import { defineOp, type OpDef } from "./registry.ts";

export const configOps: OpDef[] = [
  defineOp({
    name: "setting.set",
    tier: "B",
    description: `Change a setting. Known keys: ${Object.keys(SETTINGS).join(", ")}.`,
    input: z.object({ key: z.string(), value: z.unknown() }).strict(),
    async plan(ctx, input) {
      if (!isSettingKey(input.key)) throw new OpError("invalid_input", `unknown setting ${input.key}`);
      const parsed = SETTINGS[input.key].schema.safeParse(input.value);
      if (!parsed.success) throw new OpError("invalid_input", `invalid value for ${input.key}`, z.flattenError(parsed.error as z.ZodError));
      const value = JSON.stringify(parsed.data);
      const before = await ctx.db.first<Row>("SELECT * FROM settings WHERE key = ?", [input.key]);
      if (before?.value === value) throw new OpError("conflict", "setting already has that value");
      const after = { key: input.key, value };
      return {
        statements: [
          { sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", params: [input.key, value] },
        ],
        changes: [{ entityType: "setting", entityId: input.key, before, after }],
        result: { key: input.key, value: parsed.data },
      };
    },
  }),
  defineOp({
    name: "capacity.set",
    tier: "B",
    description: "Set the normal available working minutes for one weekday (0 = Monday) in the capacity template.",
    input: z
      .object({
        weekday: z.number().int().min(0).max(6),
        available_min: z.number().int().min(0).max(1440),
        start_time: z.string().regex(TIME_RE).nullable().optional(),
        end_time: z.string().regex(TIME_RE).nullable().optional(),
      })
      .strict()
      .refine((v) => !v.start_time || !v.end_time || v.start_time < v.end_time, "start_time must be before end_time"),
    async plan(ctx, input) {
      const before = await ctx.db.first<Row>("SELECT * FROM capacity_template WHERE weekday = ?", [input.weekday]);
      const after = { weekday: input.weekday, available_min: input.available_min, start_time: input.start_time ?? null, end_time: input.end_time ?? null };
      return {
        statements: [
          {
            sql: `INSERT INTO capacity_template (weekday, available_min, start_time, end_time) VALUES (?, ?, ?, ?)
                  ON CONFLICT(weekday) DO UPDATE SET available_min = excluded.available_min, start_time = excluded.start_time, end_time = excluded.end_time`,
            params: [after.weekday, after.available_min, after.start_time, after.end_time],
          },
        ],
        changes: [{ entityType: "capacity", entityId: String(input.weekday), before, after }],
        result: after,
      };
    },
  }),
] as OpDef[];
