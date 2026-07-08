import { describe, expect, it } from "vitest";
import { backoffDelayMs, maxBackoffDelayMs, nextRetryAt } from "../backoff";

// rand()=0.5 lands exactly in the middle of the jitter band → no jitter.
const noJitter = () => 0.5;

describe("backoffDelayMs", () => {
  it("first retry waits 1s", () => {
    expect(backoffDelayMs(0, noJitter)).toBe(1000);
  });

  it("doubles each subsequent attempt", () => {
    expect(backoffDelayMs(1, noJitter)).toBe(2000);
    expect(backoffDelayMs(2, noJitter)).toBe(4000);
    expect(backoffDelayMs(3, noJitter)).toBe(8000);
    expect(backoffDelayMs(4, noJitter)).toBe(16_000);
    expect(backoffDelayMs(5, noJitter)).toBe(32_000);
  });

  it("caps at 60s", () => {
    expect(backoffDelayMs(6, noJitter)).toBe(60_000);
    expect(backoffDelayMs(20, noJitter)).toBe(60_000);
    expect(backoffDelayMs(1_000_000, noJitter)).toBe(60_000);
  });

  it("treats negative attempts as the first retry", () => {
    expect(backoffDelayMs(-5, noJitter)).toBe(1000);
  });

  it("jitters ±20% around the base delay", () => {
    expect(backoffDelayMs(3, () => 0)).toBe(6400); // 8000 * 0.8
    expect(backoffDelayMs(3, () => 1)).toBe(9600); // 8000 * 1.2
    for (let i = 0; i < 50; i++) {
      const d = backoffDelayMs(3);
      expect(d).toBeGreaterThanOrEqual(6400);
      expect(d).toBeLessThanOrEqual(9600);
    }
  });
});

describe("maxBackoffDelayMs", () => {
  it("is the jitter upper bound", () => {
    expect(maxBackoffDelayMs(3)).toBe(9600);
    expect(maxBackoffDelayMs(50)).toBe(72_000);
  });
});

describe("nextRetryAt", () => {
  it("adds backoff to the provided now", () => {
    expect(nextRetryAt(1, 1_000_000, noJitter)).toBe(1_002_000);
  });

  it("uses the cap for large attempts", () => {
    expect(nextRetryAt(50, 1_000_000, noJitter)).toBe(1_060_000);
  });
});
