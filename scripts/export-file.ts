// Export a local SQLite file to the JSON export format. Usage: npm run export:file -- [db path] [out path]
import { writeFileSync } from "node:fs";
import { SqliteDb } from "../src/platform/node.ts";
import { exportAll } from "../src/services/export.ts";

const path = process.argv[2] ?? ".local/personal-os.sqlite";
const out = process.argv[3] ?? `exports/personal-os-export-${new Date().toISOString().slice(0, 10)}.json`;
const db = new SqliteDb(path);
const data = await exportAll(db);
db.close();
const { mkdirSync } = await import("node:fs");
const { dirname } = await import("node:path");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(data, null, 2));
console.log(`Wrote ${out}`);
