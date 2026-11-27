/**
 * Node adapters: node:sqlite for Db, a local folder for FileStore.
 * Used by tests, scripts, and as the exit path if the app ever leaves Cloudflare.
 * Never imported by the Worker entry point.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Db, FileStore, Row, SqlValue, Stmt } from "../db.ts";

export class SqliteDb implements Db {
  readonly raw: DatabaseSync;

  constructor(path = ":memory:") {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA foreign_keys = ON;");
    if (path !== ":memory:") this.raw.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  }

  async all<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  async first<T = Row>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    return (this.raw.prepare(sql).get(...params) as T | undefined) ?? null;
  }

  async batch(stmts: Stmt[]): Promise<void> {
    if (stmts.length === 0) return;
    this.raw.exec("BEGIN");
    try {
      for (const s of stmts) this.raw.prepare(s.sql).run(...(s.params ?? []));
      this.raw.exec("COMMIT");
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }

  /** Apply unapplied migrations, recording them in the same table Wrangler uses. */
  migrate(dir: string): string[] {
    this.raw.exec(
      "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const done = new Set(
      (this.raw.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((r) => r.name),
    );
    const applied: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      this.raw.exec("BEGIN");
      try {
        this.raw.exec(sql);
        this.raw.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(file);
        this.raw.exec("COMMIT");
      } catch (err) {
        this.raw.exec("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
    }
    return applied;
  }

  close(): void {
    this.raw.close();
  }
}

export class FsStore implements FileStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async put(key: string, body: string): Promise<void> {
    const path = join(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, "utf8");
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, key), "utf8");
    } catch {
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else out.push(relative(this.root, full).split("\\").join("/"));
      }
    };
    await walk(this.root);
    return out.filter((k) => k.startsWith(prefix)).sort();
  }
}
