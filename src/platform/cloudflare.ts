/// <reference types="@cloudflare/workers-types" />
/** Cloudflare adapters: D1 for Db, R2 for FileStore. The only Cloudflare-specific storage code. */
import type { Db, FileStore, Row, SqlValue, Stmt } from "../db.ts";

export class D1Db implements Db {
  private readonly d1: D1Database;
  constructor(d1: D1Database) {
    this.d1 = d1;
  }

  private prepare(sql: string, params: SqlValue[] = []): D1PreparedStatement {
    const stmt = this.d1.prepare(sql);
    return params.length ? stmt.bind(...params) : stmt;
  }

  async all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]> {
    const res = await this.prepare(sql, params).all<T>();
    return res.results ?? [];
  }

  async first<T = Row>(sql: string, params?: SqlValue[]): Promise<T | null> {
    return (await this.prepare(sql, params).first<T>()) ?? null;
  }

  async batch(stmts: Stmt[]): Promise<void> {
    if (stmts.length === 0) return;
    // D1 has no interactive transactions; a batch is applied all-or-nothing.
    await this.d1.batch(stmts.map((s) => this.prepare(s.sql, s.params)));
  }
}

export class R2Store implements FileStore {
  private readonly bucket: R2Bucket;
  constructor(bucket: R2Bucket) {
    this.bucket = bucket;
  }

  async put(key: string, body: string, contentType = "text/plain; charset=utf-8"): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType } });
  }

  async get(key: string): Promise<string | null> {
    const obj = await this.bucket.get(key);
    return obj ? await obj.text() : null;
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.bucket.list({ prefix, cursor });
      keys.push(...page.objects.map((o) => o.key));
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
}
