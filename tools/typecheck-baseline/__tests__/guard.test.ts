import { describe, expect, it } from "vitest";
import { outputTail, typecheckFailedToRun } from "../lib/guard";

describe("typecheckFailedToRun", () => {
  it("flags non-zero exit with zero parsed errors (tsc never ran)", () => {
    expect(typecheckFailedToRun(1, 0)).toBe(true);
  });

  it("flags null status (spawn failure / killed by signal) with zero parsed errors", () => {
    expect(typecheckFailedToRun(null, 0)).toBe(true);
  });

  it("passes a clean run (exit 0, zero errors)", () => {
    expect(typecheckFailedToRun(0, 0)).toBe(false);
  });

  it("passes a normal failing run (non-zero exit WITH parsed TS errors)", () => {
    expect(typecheckFailedToRun(1, 6)).toBe(false);
  });

  it("passes a run where errors parsed despite exit 0 (defensive)", () => {
    expect(typecheckFailedToRun(0, 3)).toBe(false);
  });
});

describe("outputTail", () => {
  it("returns the last N non-empty lines", () => {
    const text = "a\n\nb\nc\n\nd\n";
    expect(outputTail(text, 2)).toBe("c\nd");
  });

  it("returns everything when shorter than the limit", () => {
    expect(outputTail("only line", 30)).toBe("only line");
  });
});
