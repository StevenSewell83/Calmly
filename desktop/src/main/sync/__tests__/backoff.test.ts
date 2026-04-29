import { describe, expect, it } from "vitest";
import { backoffDelayMs, nextRetryAt } from "../backoff";

describe("backoffDelayMs", () => {
  it("first retry waits 1s", () => {
    expect(backoffDelayMs(0)).toBe(1000);
  });

  it("doubles each subsequent attempt", () => {
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(4)).toBe(16_000);
    expect(backoffDelayMs(5)).toBe(32_000);
  });

  it("caps at 60s", () => {
    expect(backoffDelayMs(6)).toBe(60_000);
    expect(backoffDelayMs(20)).toBe(60_000);
    expect(backoffDelayMs(1_000_000)).toBe(60_000);
  });

  it("treats negative attempts as the first retry", () => {
    expect(backoffDelayMs(-5)).toBe(1000);
  });
});

describe("nextRetryAt", () => {
  it("adds backoff to the provided now", () => {
    expect(nextRetryAt(1, 1_000_000)).toBe(1_002_000);
  });

  it("uses the cap for large attempts", () => {
    expect(nextRetryAt(50, 1_000_000)).toBe(1_060_000);
  });
});
