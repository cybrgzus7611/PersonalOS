import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      projects: [
        {
          // Shared suites against the node:sqlite adapter (fast; also proves the app runs off Cloudflare).
          test: { name: "node", include: ["test/node/**/*.test.ts"], environment: "node" },
        },
        {
          // The same suites inside the Workers runtime against a local D1 database.
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: { TEST_MIGRATIONS: migrations, ENVIRONMENT: "development" },
                d1Databases: ["RESTORE_DB", "SEED_DB"],
              },
            }),
          ],
          test: { name: "workers", include: ["test/workers/**/*.test.ts"], setupFiles: ["./test/workers/apply-migrations.ts"] },
        },
      ],
    },
  };
});
