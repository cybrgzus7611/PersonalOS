/**
 * Storage interfaces. Everything outside src/platform/ talks only to these, so the app
 * runs on Cloudflare (D1 + R2) and on plain Node (node:sqlite + local folder).
 */
export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface Stmt {
  sql: string;
  params?: SqlValue[];
}

export interface Db {
  /** Run a read query and return every row. */
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Run a read query and return the first row, or null. */
  first<T = Row>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Run write statements atomically: all apply or none do. */
  batch(stmts: Stmt[]): Promise<void>;
}

export interface FileStore {
  put(key: string, body: string, contentType?: string): Promise<void>;
  get(key: string): Promise<string | null>;
  list(prefix: string): Promise<string[]>;
}
