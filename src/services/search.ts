import type { Db } from "../db.ts";
import { ENTITIES, type EntityType } from "../ops/entities.ts";

export interface SearchHit {
  entity_type: string;
  entity_id: string;
  day: string | null;
  snippet: string;
}

/** Turn free text into a safe FTS5 query: each word quoted, prefix-matched, all words required. */
export function toFtsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return null;
  return words.slice(0, 12).map((w) => `"${w}"*`).join(" ");
}

/** Snippet-only search: ranked snippets with ids, never whole records. */
export async function search(db: Db, text: string, opts: { types?: string[]; limit?: number } = {}): Promise<SearchHit[]> {
  const q = toFtsQuery(text);
  if (!q) return [];
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const params: (string | number)[] = [q];
  let filter = "";
  if (opts.types?.length) {
    filter = ` AND entity_type IN (${opts.types.map(() => "?").join(", ")})`;
    params.push(...opts.types);
  }
  params.push(limit);
  return db.all<SearchHit>(
    `SELECT entity_type, entity_id, day, snippet(search, 3, '[', ']', ' … ', 12) AS snippet
       FROM search WHERE search MATCH ?${filter} ORDER BY rank LIMIT ?`,
    params,
  );
}

/** Rebuild the whole search index from the entity tables (after an import or restore). */
export async function reindexAll(db: Db): Promise<number> {
  const stmts: { sql: string; params: (string | null)[] }[] = [{ sql: "DELETE FROM search", params: [] }];
  for (const [type, m] of Object.entries(ENTITIES) as [EntityType, (typeof ENTITIES)[EntityType]][]) {
    if (!("searchBody" in m) || !m.searchBody) continue;
    const rows = await db.all<Record<string, unknown>>(`SELECT * FROM ${m.table} WHERE archived_at IS NULL`);
    for (const r of rows) {
      const day = "searchDay" in m && m.searchDay ? m.searchDay(r) : null;
      stmts.push({ sql: "INSERT INTO search (entity_type, entity_id, day, body) VALUES (?, ?, ?, ?)", params: [type, r.id as string, day, m.searchBody(r)] });
    }
  }
  await db.batch(stmts);
  return stmts.length - 1;
}
