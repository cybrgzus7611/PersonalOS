import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_SCHEMAS } from "../../src/api/contract.ts";

const DIR = "test/fixtures/api";

describe("API fixtures for the frontend", () => {
  it("has exactly one committed fixture per contract entry", () => {
    expect(readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()).toEqual(Object.keys(FIXTURE_SCHEMAS).sort());
  });

  for (const [file, schema] of Object.entries(FIXTURE_SCHEMAS)) {
    it(`${file} matches the contract (regenerate with npm run fixtures:api)`, () => {
      const r = schema.safeParse(JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")));
      expect(r.success ? [] : r.error.issues).toEqual([]);
    });
  }
});
