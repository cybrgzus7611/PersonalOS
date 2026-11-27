import { SqliteDb } from "../../src/platform/node.ts";
import { coverageSuite, opsSuite } from "../shared/ops.suite.ts";
import { planningSuite, quickAddSuite } from "../shared/planning.suite.ts";
import { contractSuite } from "../shared/contract.suite.ts";
import { apiSuite } from "../shared/api.suite.ts";
import { exportSuite } from "../shared/export.suite.ts";

const fresh = async () => {
  const db = new SqliteDb(":memory:");
  db.migrate("migrations");
  return db;
};

opsSuite(fresh, fresh);
apiSuite(fresh);
exportSuite(fresh, fresh);
planningSuite(fresh);
quickAddSuite(fresh);
contractSuite(fresh);
coverageSuite();
