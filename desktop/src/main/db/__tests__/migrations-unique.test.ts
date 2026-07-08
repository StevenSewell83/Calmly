import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { assertUniqueVersions } from "../migrations";

describe("assertUniqueVersions", () => {
  it("accepts a clean sequential set", () => {
    expect(() =>
      assertUniqueVersions([
        { version: 1, name: "init" },
        { version: 2, name: "fts" },
      ]),
    ).not.toThrow();
  });

  it("throws on a duplicate version, naming both migrations", () => {
    expect(() =>
      assertUniqueVersions([
        { version: 9, name: "user_settings_id" },
        { version: 9, name: "stuck_sessions" },
      ]),
    ).toThrow(/version 9.*"user_settings_id".*"stuck_sessions"/);
  });
});

// Guard against the calmly-wv9 collision class recurring in the actual
// migrations directory (parallel workers picking the same next number).
describe("migrations directory", () => {
  const dir = path.resolve(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f));

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
