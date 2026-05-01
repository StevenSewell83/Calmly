import { describe, expect, it } from "vitest";
import { diff, isCleanDiff, type BaselineEntry } from "../lib/diff";
import type { ErrorBucket } from "../lib/parse";

function bucket(
  workspace: string,
  file: string,
  code: string,
  count: number,
): ErrorBucket {
  return { workspace, file, code, count };
}
function entry(
  workspace: string,
  file: string,
  code: string,
  count: number,
): BaselineEntry {
  return { workspace, file, code, count };
}

describe("diff", () => {
  it("flags brand-new (workspace,file,code) keys as added", () => {
    const d = diff([bucket("desktop", "a.ts", "TS1", 1)], []);
    expect(d.added).toHaveLength(1);
    expect(isCleanDiff(d)).toBe(false);
  });

  it("flags higher counts as increased", () => {
    const d = diff(
      [bucket("desktop", "a.ts", "TS1", 3)],
      [entry("desktop", "a.ts", "TS1", 1)],
    );
    expect(d.increased).toEqual([
      { current: bucket("desktop", "a.ts", "TS1", 3), baseline: 1 },
    ]);
    expect(isCleanDiff(d)).toBe(false);
  });

  it("counts an exact-match entry as silenced (clean)", () => {
    const d = diff(
      [bucket("desktop", "a.ts", "TS1", 2)],
      [entry("desktop", "a.ts", "TS1", 2)],
    );
    expect(d.silenced).toBe(2);
    expect(d.added).toEqual([]);
    expect(d.increased).toEqual([]);
    expect(isCleanDiff(d)).toBe(true);
  });

  it("flags lower counts as decreased — a clean diff still", () => {
    const d = diff(
      [bucket("desktop", "a.ts", "TS1", 1)],
      [entry("desktop", "a.ts", "TS1", 3)],
    );
    expect(d.decreased).toEqual([
      { current: bucket("desktop", "a.ts", "TS1", 1), baseline: 3 },
    ]);
    expect(d.silenced).toBe(1);
    expect(isCleanDiff(d)).toBe(true);
  });

  it("reports baseline keys with no current matches as fixed", () => {
    const d = diff([], [entry("desktop", "a.ts", "TS1", 2)]);
    expect(d.fixed).toEqual([entry("desktop", "a.ts", "TS1", 2)]);
    expect(isCleanDiff(d)).toBe(true);
  });

  it("treats empty current + empty baseline as clean and silenced=0", () => {
    expect(diff([], [])).toEqual({
      added: [],
      increased: [],
      decreased: [],
      fixed: [],
      silenced: 0,
    });
  });

  it("handles mixed (some clean, some new, some fixed) in one pass", () => {
    const current = [
      bucket("desktop", "a.ts", "TS1", 2), // clean
      bucket("desktop", "a.ts", "TS2", 1), // brand new — fail
      bucket("desktop", "b.ts", "TS1", 5), // increased — fail
    ];
    const baseline = [
      entry("desktop", "a.ts", "TS1", 2),
      entry("desktop", "b.ts", "TS1", 3),
      entry("desktop", "fixed.ts", "TS1", 1), // fixed
    ];
    const d = diff(current, baseline);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]?.code).toBe("TS2");
    expect(d.increased).toHaveLength(1);
    expect(d.fixed).toHaveLength(1);
    expect(d.silenced).toBe(2);
    expect(isCleanDiff(d)).toBe(false);
  });
});
