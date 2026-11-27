// Create or update a plain SQLite file with the schema and starting data, without Wrangler.
// Usage: npm run seed:file -- [path]   (default: .local/personal-os.sqlite, git-ignored)
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SqliteDb } from "../src/platform/node.ts";
import { registry } from "../src/ops/index.ts";
import { seed } from "../src/seed.ts";

const path = process.argv[2] ?? ".local/personal-os.sqlite";
mkdirSync(dirname(path), { recursive: true });
const db = new SqliteDb(path);
const applied = db.migrate("migrations");
const result = await seed(db, registry);
db.close();
console.log(`${path}: migrations applied ${applied.length ? applied.join(", ") : "none"}; ${result.seeded ? "seeded" : "already seeded"}.`);
