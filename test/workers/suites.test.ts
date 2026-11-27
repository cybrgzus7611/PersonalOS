import { env } from "cloudflare:workers";
import { D1Db } from "../../src/platform/cloudflare.ts";
import { opsSuite } from "../shared/ops.suite.ts";
import { apiSuite } from "../shared/api.suite.ts";
import { exportSuite } from "../shared/export.suite.ts";

const e = env as unknown as { DB: D1Database; RESTORE_DB: D1Database; SEED_DB: D1Database };
const shared = async () => new D1Db(e.DB);

opsSuite(shared, async () => new D1Db(e.SEED_DB));
apiSuite(shared);
exportSuite(shared, async () => new D1Db(e.RESTORE_DB));
