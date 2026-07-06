import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";

// calmly-wv9: runtime-level regression test for the migration
// version-collision bug. Runs the FULL migration sweep — every file under
// migrations/ — through the actual runMigrations() function (the same code
// db/index.ts calls on every app boot) against a fresh DB, so a version
// collision reproduces the exact `SqliteError: UNIQUE constraint failed:
// _meta_migrations.version` that broke app boot post-merge, not just a
// static filename scan (see migration-versions.test.ts for that check).
//
// Substrate: node:sqlite's DatabaseSync rather than better-sqlite3 — this
// repo's better-sqlite3 binding is rebuilt for Electron's ABI via
// postinstall (see integration.test.ts), which is incompatible with
// vitest's host Node. We adapt DatabaseSync to the minimal slice of
// better-sqlite3's Database.Database interface that runMigrations() calls
// (exec / prepare / transaction), so the exact production code path runs.

interface NodeSqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
}

// Lazy-require so a host Node without node:sqlite skips the suite cleanly
// rather than crashing the whole test run (mirrors integration.test.ts).
let nodeSqlite: NodeSqliteModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodeSqlite = require("node:sqlite") as NodeSqliteModule;
} catch {
  nodeSqlite = null;
}

function asMigrationsDb(raw: NodeSqliteDatabase): Database.Database {
  return {
    exec: (sql: string) => {
      raw.exec(sql);
    },
    prepare: (sql: string) => {
      const stmt = raw.prepare(sql);
      return {
        all: (...args: unknown[]) => stmt.all(...args),
        get: (...args: unknown[]) => stmt.get(...args),
        run: (...args: unknown[]) => stmt.run(...args),
      };
    },
    transaction: (fn: (...args: unknown[]) => unknown) => {
      return (...args: unknown[]) => {
        raw.exec("BEGIN");
        try {
          const result = fn(...args);
          raw.exec("COMMIT");
          return result;
        } catch (err) {
          raw.exec("ROLLBACK");
          throw err;
        }
      };
    },
  } as unknown as Database.Database;
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");
const migrationFileCount = readdirSync(migrationsDir).filter((f) =>
  /^\d+_.+\.sql$/.test(f),
).length;

describe.skipIf(!nodeSqlite)("calmly-wv9 · full migration sweep", () => {
  it("applies every migration on a fresh DB with no version collisions", () => {
    const raw = new nodeSqlite!.DatabaseSync(":memory:");
    const db = asMigrationsDb(raw);

    const result = runMigrations(db);

    expect(result.appliedNow).toHaveLength(migrationFileCount);
    expect(result.current).toBe(Math.max(...result.appliedNow));
  });

  it("is idempotent — re-running applies nothing new and doesn't re-collide", () => {
    const raw = new nodeSqlite!.DatabaseSync(":memory:");
    const db = asMigrationsDb(raw);

    const first = runMigrations(db);
    const second = runMigrations(db);

    expect(second.appliedNow).toEqual([]);
    expect(second.current).toBe(first.current);
  });
});
