import type { Db } from "../db.ts";
import { SETTINGS, settingDefaults, type SettingKey } from "../settings.ts";

/** All settings with defaults filled in for keys not yet stored. */
export async function readSettings(db: Db): Promise<Record<string, unknown>> {
  const out = settingDefaults();
  for (const row of await db.all<{ key: string; value: string }>("SELECT key, value FROM settings")) {
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      // A corrupt value falls back to the default rather than breaking every request.
    }
  }
  return out;
}

export async function readSetting<K extends SettingKey>(db: Db, key: K): Promise<(typeof SETTINGS)[K]["default"]> {
  const row = await db.first<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]);
  if (!row) return SETTINGS[key].default;
  try {
    return JSON.parse(row.value);
  } catch {
    return SETTINGS[key].default;
  }
}
