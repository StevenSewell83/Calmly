import type Database from "better-sqlite3";

const migrationFiles = import.meta.glob<string>("./migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

interface Migration {
  version: number;
  name: string;
  sql: string;
}

interface MigrationRow {
  version: number;
}

export interface MigrationResult {
  appliedNow: number[];
  current: number;
}

/** Throws when two migrations declare the same version number. Without this
 * guard the collision only surfaces on a user's machine as a cryptic
 * `UNIQUE constraint failed: _meta_migrations.version` at boot (the calmly-wv9
 * P0) — fail loudly at load time instead. Exported for tests. */
export function assertUniqueVersions(
  migrations: ReadonlyArray<{ version: number; name: string }>,
): void {
  const byVersion = new Map<number, string>();
  for (const m of migrations) {
    const existing = byVersion.get(m.version);
    if (existing !== undefined) {
      throw new Error(
        `Duplicate migration version ${m.version}: declared by both ` +
          `"${existing}" and "${m.name}". Renumber one of them.`,
      );
    }
    byVersion.set(m.version, m.name);
  }
}

function loadMigrations(): Migration[] {
  const out: Migration[] = [];
  for (const [path, sql] of Object.entries(migrationFiles)) {
    const file = path.split("/").pop();
    if (!file) continue;
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;
    const versionStr = match[1];
    const name = match[2];
    if (!versionStr || !name) continue;
    out.push({ version: parseInt(versionStr, 10), name, sql });
  }
  out.sort((a, b) => a.version - b.version);
  assertUniqueVersions(out);
  return out;
}

export function runMigrations(db: Database.Database): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const rows = db
    .prepare("SELECT version FROM _meta_migrations")
    .all() as MigrationRow[];
  const applied = new Set<number>(rows.map((r) => r.version));

  const migrations = loadMigrations();
  const appliedNow: number[] = [];

  const insert = db.prepare(
    "INSERT INTO _meta_migrations (version, name) VALUES (?, ?)",
  );

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      insert.run(m.version, m.name);
    });
    tx();
    appliedNow.push(m.version);
  }

  const tip = db
    .prepare("SELECT MAX(version) AS v FROM _meta_migrations")
    .get() as { v: number | null };
  return { appliedNow, current: tip.v ?? 0 };
}
