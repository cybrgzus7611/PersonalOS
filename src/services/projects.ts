/** Read model for the project register: every project with its task counts, in one request. */
import type { Db, Row } from "../db.ts";

export async function projectRegister(db: Db, opts: { includeArchived?: boolean } = {}) {
  const items = await db.all<Row>(
    `SELECT p.*,
       (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL AND t.status IN ('todo','in_progress','backlog')) AS open_task_count,
       (SELECT count(*) FROM tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL AND t.status = 'done') AS done_task_count,
       (SELECT min(t.due_day) FROM tasks t WHERE t.project_id = p.id AND t.archived_at IS NULL AND t.status IN ('todo','in_progress','backlog') AND t.due_day IS NOT NULL) AS next_task_due_day
     FROM projects p
     ${opts.includeArchived ? "" : "WHERE p.archived_at IS NULL"}
     ORDER BY p.archived_at IS NOT NULL, p.priority, p.due_day IS NULL, p.due_day, p.title`,
  );
  return { items };
}
