import type { Db, Row, SqlValue, Stmt } from "../db.ts";
import { OpError } from "../errors.ts";
import { reindexAll } from "./search.ts";

export const SCHEMA_VERSION = 1;

/** Data tables in foreign-key order (parents first). The search index is derived and rebuilt on import. */
export const EXPORT_TABLES = [
  "settings",
  "workstreams",
  "capacity_template",
  "days",
  "objectives",
  "projects",
  "milestones",
  "weekly_outcomes",
  "tasks",
  "task_dependencies",
  "time_blocks",
  "block_submissions",
  "ideas",
  "decisions",
  "notes",
  "documents",
  "document_versions",
  "reviews",
  "conversations",
  "messages",
  "ai_proposals",
  "events",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

export function isExportTable(name: string): name is ExportTable {
  return (EXPORT_TABLES as readonly string[]).includes(name);
}

/** Stable row order: by id where the table has one (ULIDs sort by creation), else by its key columns. */
const ORDER: Partial<Record<ExportTable, string>> = {
  settings: "key",
  capacity_template: "weekday",
  days: "day",
  task_dependencies: "task_id, depends_on_id",
  document_versions: "document_id, version",
};

export interface ExportFile {
  format: "personal-os-export";
  schema_version: number;
  exported_at: string;
  tables: Record<ExportTable, Row[]>;
}

const PAGE = 500;

export async function exportTable(db: Db, table: ExportTable): Promise<Row[]> {
  const order = ORDER[table] ?? "id";
  const rows: Row[] = [];
  // Paged reads keep each query small (the free Workers plan limits CPU per request).
  for (let offset = 0; ; offset += PAGE) {
    const page = await db.all<Row>(`SELECT * FROM ${table} ORDER BY ${order} LIMIT ? OFFSET ?`, [PAGE, offset]);
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export async function exportAll(db: Db, now: string = new Date().toISOString()): Promise<ExportFile> {
  const tables = {} as Record<ExportTable, Row[]>;
  for (const t of EXPORT_TABLES) tables[t] = await exportTable(db, t);
  return { format: "personal-os-export", schema_version: SCHEMA_VERSION, exported_at: now, tables };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function tableToCsv(db: Db, table: ExportTable): Promise<string> {
  const rows = await exportTable(db, table);
  const cols = rows.length
    ? Object.keys(rows[0])
    : (await db.all<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`)).map((c) => c.name);
  const lines = [cols.map(csvCell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/**
 * Load an export into an empty database (restore). Refuses a database that already holds data,
 * so a restore can never silently merge with or overwrite live records.
 */
export async function importAll(db: Db, file: ExportFile): Promise<Record<string, number>> {
  if (file?.format !== "personal-os-export") throw new OpError("invalid_input", "not a Personal OS export file");
  if (file.schema_version !== SCHEMA_VERSION) {
    throw new OpError("invalid_input", `export is schema version ${file.schema_version}; this build expects ${SCHEMA_VERSION}`);
  }
  for (const t of EXPORT_TABLES) {
    const row = await db.first<{ n: number }>(`SELECT count(*) AS n FROM ${t}`);
    if ((row?.n ?? 0) > 0) throw new OpError("conflict", `target database is not empty (${t} has rows)`);
  }
  const counts: Record<string, number> = {};
  const stmts: Stmt[] = [];
  const undone: Stmt[] = [];
  for (const t of EXPORT_TABLES) {
    const rows = file.tables[t] ?? [];
    counts[t] = rows.length;
    for (const r of rows) {
      const row = { ...r };
      // events.undone_by points at a later event, so it is set after all events exist.
      if (t === "events" && row.undone_by) {
        undone.push({ sql: "UPDATE events SET undone_by = ? WHERE id = ?", params: [row.undone_by as string, row.id as string] });
        row.undone_by = null;
      }
      const cols = Object.keys(row);
      stmts.push({
        sql: `INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        params: cols.map((c) => row[c] as SqlValue),
      });
    }
  }
  await db.batch([...stmts, ...undone]);
  await reindexAll(db);
  return counts;
}
