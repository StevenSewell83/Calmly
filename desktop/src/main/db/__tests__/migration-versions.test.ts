import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// calmly-wv9: structural regression test for the migration version-collision
// bug (workers picked the same next-available number independently, so two
// files claimed version 0010 — the runner's UNIQUE constraint on
// _meta_migrations.version then broke app boot post-merge). Pure filesystem
// scan, no DB dependency, so it runs in every environment and catches the
// mistake at the source rather than only when all migrations are applied
// together (see also migration-sweep.test.ts for the runtime-level check).

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

interface ParsedMigration {
  version: number;
  file: string;
}

function parseMigrations(): ParsedMigration[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .map((file) => {
      const match = file.match(/^(\d+)_.+\.sql$/);
      if (!match || !match[1]) {
        throw new Error(
          `Migration file "${file}" doesn't match the NNNN_name.sql naming convention.`,
        );
      }
      return { version: parseInt(match[1], 10), file };
    });
}

describe("calmly-wv9 · migration version numbering", () => {
  it("has no duplicate version numbers across migration files", () => {
    const byVersion = new Map<number, string[]>();
    for (const m of parseMigrations()) {
      byVersion.set(m.version, [...(byVersion.get(m.version) ?? []), m.file]);
    }
    const collisions = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `version ${version}: ${files.join(", ")}`);

    expect(collisions).toEqual([]);
  });

  it("has no gaps in the version sequence", () => {
    const versions = parseMigrations()
      .map((m) => m.version)
      .sort((a, b) => a - b);
    const min = versions[0] ?? 0;
    const max = versions[versions.length - 1] ?? 0;
    const expected = Array.from({ length: max - min + 1 }, (_, i) => min + i);

    expect(versions).toEqual(expected);
  });
});
