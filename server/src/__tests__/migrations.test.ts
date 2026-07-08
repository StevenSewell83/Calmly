import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// Guards against duplicate migration version numbers (calmly-aa3.3 /
// calmly-aa3.4). node-pg-migrate orders lexicographically by filename, so
// two files sharing a numeric prefix have an ambiguous intended order —
// the exact collision class that broke desktop boot (848761e).
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "..", "migrations");

describe("server migrations directory", () => {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.cjs$/.test(f));

  it("has at least one migration", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("has no duplicate version prefixes", () => {
    const byPrefix = new Map<string, string[]>();
    for (const f of files) {
      const prefix = f.split("_")[0]!;
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), f]);
    }
    const duplicates = [...byPrefix.entries()].filter(([, v]) => v.length > 1);
    expect(duplicates).toEqual([]);
  });
});
