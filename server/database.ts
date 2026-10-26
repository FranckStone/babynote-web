import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database, DatabaseStatement } from "../worker/app";

export class SQLiteDatabase implements Database {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }

  prepare(query: string): DatabaseStatement {
    const statement = this.connection.prepare(query);
    const wrap = (values: SQLInputValue[]): DatabaseStatement => ({
      bind: (...args) => wrap(args as SQLInputValue[]),
      all: async <T>() => ({ results: statement.all(...values) as T[] }),
      first: async <T>() => (statement.get(...values) as T | undefined) ?? null,
      run: async () => {
        const result = statement.run(...values);
        return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    });
    return wrap([]);
  }

  migrate(directory: string) {
    // Share the D1 migration ledger so an imported export is not migrated twice.
    this.connection.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
      if (this.connection.prepare("SELECT 1 FROM d1_migrations WHERE name = ?").get(name)) continue;
      this.connection.exec("BEGIN IMMEDIATE");
      try {
        this.connection.exec(readFileSync(join(directory, name), "utf8"));
        this.connection.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(name);
        this.connection.exec("COMMIT");
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close() {
    this.connection.close();
  }
}
