import type { Db, Row, SqlValue, Stmt } from "../db.ts";
import { OpError } from "../errors.ts";

/** Entities the ops layer can change, with their table and full-text search body. */
export interface EntityMeta {
  table: string;
  key: string;
  /** Text indexed in the FTS5 `search` table, or undefined if the entity is not searchable. */
  searchBody?: (row: Row) => string;
  /** Calendar day stored with the search row, if any. */
  searchDay?: (row: Row) => string | null;
  /** Whether the row has an archived_at column used for soft deletion. */
  archivable: boolean;
}

const join = (...parts: unknown[]) => parts.filter((p) => typeof p === "string" && p.length > 0).join("\n");

export const ENTITIES = {
  workstream: { table: "workstreams", key: "id", archivable: true },
  objective: { table: "objectives", key: "id", archivable: true, searchBody: (r) => join(r.title, r.description) },
  project: {
    table: "projects",
    key: "id",
    archivable: true,
    searchBody: (r) => join(r.title, r.description, r.client_name, r.health_note),
  },
  milestone: { table: "milestones", key: "id", archivable: true, searchBody: (r) => join(r.title) },
  task: {
    table: "tasks",
    key: "id",
    archivable: true,
    searchBody: (r) => join(r.title, r.notes),
    searchDay: (r) => (r.planned_day as string | null) ?? null,
  },
  idea: { table: "ideas", key: "id", archivable: true, searchBody: (r) => join(r.title, r.notes) },
  decision: {
    table: "decisions",
    key: "id",
    archivable: true,
    searchBody: (r) => join(r.title, r.rationale),
    searchDay: (r) => r.day as string,
  },
  note: {
    table: "notes",
    key: "id",
    archivable: true,
    searchBody: (r) => join(r.body),
    searchDay: (r) => r.day as string,
  },
  document: { table: "documents", key: "id", archivable: true, searchBody: (r) => join(r.path, r.body) },
  task_dependency: { table: "task_dependencies", key: "task_id", archivable: false },
  day: { table: "days", key: "day", archivable: false },
  weekly_outcome: { table: "weekly_outcomes", key: "id", archivable: true },
  setting: { table: "settings", key: "key", archivable: false },
  capacity: { table: "capacity_template", key: "weekday", archivable: false },
} satisfies Record<string, EntityMeta>;

export type EntityType = keyof typeof ENTITIES;

export function meta(type: EntityType): EntityMeta {
  return ENTITIES[type];
}

export function isEntityType(value: string): value is EntityType {
  return Object.prototype.hasOwnProperty.call(ENTITIES, value);
}

export async function getRow(db: Db, type: EntityType, id: string | number): Promise<Row | null> {
  const m = meta(type);
  return db.first(`SELECT * FROM ${m.table} WHERE ${m.key} = ?`, [id]);
}

export async function requireRow(db: Db, type: EntityType, id: string | number): Promise<Row> {
  const row = await getRow(db, type, id);
  if (!row) throw new OpError("not_found", `${type} ${id} not found`);
  return row;
}

/** Require that a referenced row exists and is not archived (new links to archived rows are refused). */
export async function requireActiveRef(db: Db, type: EntityType, id: string | null | undefined, field: string): Promise<Row | null> {
  if (id == null) return null;
  const row = await getRow(db, type, id);
  if (!row) throw new OpError("invalid_input", `${field}: ${type} ${id} does not exist`);
  if (row.archived_at) throw new OpError("rule_violation", `${field}: ${type} ${id} is archived`);
  return row;
}

function toSql(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

export function insertStmt(type: EntityType, row: Row): Stmt {
  const cols = Object.keys(row);
  return {
    sql: `INSERT INTO ${meta(type).table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    params: cols.map((c) => toSql(row[c])),
  };
}

export function updateStmt(type: EntityType, id: string | number, patch: Row): Stmt {
  const m = meta(type);
  const cols = Object.keys(patch).filter((c) => c !== m.key);
  return {
    sql: `UPDATE ${m.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${m.key} = ?`,
    params: [...cols.map((c) => toSql(patch[c])), id],
  };
}

export function deleteStmt(type: EntityType, id: string | number): Stmt {
  const m = meta(type);
  return { sql: `DELETE FROM ${m.table} WHERE ${m.key} = ?`, params: [id] };
}

/** Normalise a row the way the database would return it (booleans as 0/1, undefined as null). */
export function normalise(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = toSql(v);
  return out;
}

export function dependencyId(row: { task_id: string; depends_on_id: string }): string {
  return `${row.task_id}>${row.depends_on_id}`;
}

const defaultsCache = new Map<string, Row>();

/** Column defaults from the schema, so a created row (and its event) records every column. */
export async function columnDefaults(db: Db, type: EntityType): Promise<Row> {
  const table = meta(type).table;
  const cached = defaultsCache.get(table);
  if (cached) return cached;
  const cols = await db.all<{ name: string; dflt_value: string | null }>(`SELECT name, dflt_value FROM pragma_table_info('${table}')`);
  const out: Row = {};
  for (const c of cols) {
    const d = c.dflt_value;
    if (d === null || d.toUpperCase() === "NULL") out[c.name] = null;
    else if (/^-?\d+(\.\d+)?$/.test(d)) out[c.name] = Number(d);
    else if (/^'.*'$/s.test(d)) out[c.name] = d.slice(1, -1).replace(/''/g, "'");
    else out[c.name] = null; // expressions such as CURRENT_TIMESTAMP are not used by entity tables
  }
  defaultsCache.set(table, out);
  return out;
}
