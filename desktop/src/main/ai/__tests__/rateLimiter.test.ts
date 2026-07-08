import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter } from "../rateLimiter";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const rl = new RateLimiter({ maxRequests: 5, windowMs: 10_000 });
    for (let i = 0; i < 5; i++) {
      expect(rl.check()).toBe(0);
    }
  });

  it("returns wait time when limit exceeded", () => {
    const rl = new RateLimiter({ maxRequests: 3, windowMs: 10_000 });
    rl.check();
    rl.check();
    rl.check(); // fill up
    const wait = rl.check();
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(10_000);
  });

  it("suspends on quota error for 60s", () => {
    const rl = new RateLimiter({ maxRequests: 100, windowMs: 10_000 });
    expect(rl.isSuspended).toBe(false);
    rl.onQuotaError();
    expect(rl.isSuspended).toBe(true);
    const waitMs = rl.check();
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeLessThanOrEqual(60_000);
  });

  it("allows requests after window expires", () => {
    vi.useFakeTimers();
    const rl = new RateLimiter({ maxRequests: 2, windowMs: 1_000 });
    rl.check();
    rl.check(); // fill
    expect(rl.check()).toBeGreaterThan(0); // blocked

    vi.advanceTimersByTime(1_001);
    expect(rl.check()).toBe(0); // allowed again
  });
});
