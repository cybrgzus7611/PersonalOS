import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

const e = env as unknown as { DB: D1Database; RESTORE_DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
await applyD1Migrations(e.RESTORE_DB, e.TEST_MIGRATIONS);
await applyD1Migrations((env as unknown as { SEED_DB: D1Database }).SEED_DB, e.TEST_MIGRATIONS);
