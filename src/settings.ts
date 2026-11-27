import { z } from "zod";
import { isValidTimeZone, TIME_RE } from "./time.ts";

/** Known settings, their validation and defaults. Values are stored as JSON in the settings table. */
export const SETTINGS = {
  timezone: {
    schema: z.string().refine(isValidTimeZone, "must be an IANA time zone such as Europe/London"),
    default: "UTC",
    description: "IANA time zone used to decide which calendar day an action belongs to.",
  },
  planning_days: {
    schema: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    default: [0, 1, 2, 3, 4, 5],
    description: "Weekdays in the default planning week (0 = Monday). Sunday is optional work.",
  },
  day_close_time: {
    schema: z.string().regex(TIME_RE, "must be HH:MM"),
    default: "04:00",
    description: "Local time after which an unclosed day is closed automatically.",
  },
  "score.weights": {
    schema: z
      .object({ execution: z.number().min(0).max(1), adherence: z.number().min(0).max(1), focus: z.number().min(0).max(1) })
      .strict()
      .refine((w) => Math.abs(w.execution + w.adherence + w.focus - 1) < 1e-9, "weights must sum to 1"),
    default: { execution: 0.4, adherence: 0.3, focus: 0.3 },
    description: "Weights of the weekly composite used only for rewards.",
  },
  "reward.tiers": {
    schema: z
      .array(z.object({ min: z.number().min(0).max(1), reward: z.string().min(1).max(40) }).strict())
      .min(1)
      .max(6),
    default: [
      { min: 0.85, reward: "Pizza" },
      { min: 0.75, reward: "Burger or kebab" },
    ],
    description: "Weekly composite thresholds and their rewards, highest first. Below the lowest: review and reset.",
  },
  "reward.min_committed_blocks": {
    schema: z.number().int().min(0).max(200),
    default: 10,
    description: "A week with fewer committed blocks shows its composite but earns no reward.",
  },
  "output.weekly_target": {
    schema: z.number().int().min(0).max(200),
    default: 5,
    description: "Number of deliverables you aim to finish each week.",
  },
} as const;

export type SettingKey = keyof typeof SETTINGS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS, key);
}

export function settingDefaults(): Record<string, unknown> {
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));
}
