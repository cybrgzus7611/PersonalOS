import { SqliteDb } from "../../src/platform/node.ts";
import { opsSuite } from "../shared/ops.suite.ts";
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
