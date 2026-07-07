import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
  computeNextFire,
  isDue,
  isBlockedByInFlight,
  isExhausted,
  isRetryDue,
  isTaskActionable,
  type LastDeliverySnapshot,
  type RuleForScheduling,
} from "../state";

function rule(overrides: Partial<RuleForScheduling> = {}): RuleForScheduling {
  return {
    id: "rule-1",
    taskId: "task-1",
    userId: "user-1",
    intervalSeconds: 1800,
    active: true,
    updatedAt: 1_000_000,
    ...overrides,
  };
}

describe("isTaskActionable", () => {
  it("open task is actionable", () => {
    expect(isTaskActionable({ status: "open", deletedAt: null })).toBe(true);
  });

  it("in_progress task is actionable", () => {
    expect(isTaskActionable({ status: "in_progress", deletedAt: null })).toBe(true);
  });

  it("snoozed task is actionable", () => {
    expect(isTaskActionable({ status: "snoozed", deletedAt: null })).toBe(true);
  });

  it("done task is not actionable", () => {
    expect(isTaskActionable({ status: "done", deletedAt: null })).toBe(false);
  });

  it("dropped task is not actionable", () => {
    expect(isTaskActionable({ status: "dropped", deletedAt: null })).toBe(false);
  });

  it("soft-deleted task is not actionable regardless of status", () => {
    expect(isTaskActionable({ status: "open", deletedAt: 12345 })).toBe(false);
  });
});

describe("computeNextFire", () => {
  it("inactive rule never fires", () => {
    expect(computeNextFire(rule({ active: false }), null)).toBeNull();
  });

  it("first fire is activation (updatedAt) + interval when there's no history", () => {
    const r = rule({ updatedAt: 1_000_000, intervalSeconds: 1800 });
    expect(computeNextFire(r, null)).toBe(1_000_000 + 1_800_000);
  });

  it("repeat fire is last delivery's slot + interval", () => {
    const r = rule({ intervalSeconds: 1800 });
    const last: LastDeliverySnapshot = { scheduledFor: 5_000_000, status: "sent" };
    expect(computeNextFire(r, last)).toBe(5_000_000 + 1_800_000);
  });

  it("uses history over the activation timestamp once history exists", () => {
    const r = rule({ updatedAt: 1, intervalSeconds: 60 });
    const last: LastDeliverySnapshot = { scheduledFor: 10_000, status: "failed" };
    expect(computeNextFire(r, last)).toBe(10_000 + 60_000);
  });
});

describe("isDue", () => {
  it("null next-fire is never due", () => {
    expect(isDue(null, Date.now())).toBe(false);
  });

  it("is due once now reaches next fire", () => {
    expect(isDue(1000, 1000)).toBe(true);
    expect(isDue(1000, 1001)).toBe(true);
  });

  it("is not due before next fire", () => {
    expect(isDue(1000, 999)).toBe(false);
  });
});

describe("isBlockedByInFlight", () => {
  it("blocks while the last delivery is still pending (mid-retries)", () => {
    expect(
      isBlockedByInFlight({ scheduledFor: 1_000_000, status: "pending" }),
    ).toBe(true);
  });

  it("does not block for terminal or actioned statuses", () => {
    for (const status of ["sent", "failed", "skipped", "acked", "snoozed"] as const) {
      expect(isBlockedByInFlight({ scheduledFor: 1_000_000, status })).toBe(false);
    }
  });

  it("does not block when the rule has never fired", () => {
    expect(isBlockedByInFlight(null)).toBe(false);
  });
});

describe("retry backoff", () => {
  it("backoff schedule is 1m / 5m / 15m", () => {
    expect(RETRY_BACKOFF_MS).toEqual([60_000, 300_000, 900_000]);
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it("isExhausted is false below the max and true at/after it", () => {
    expect(isExhausted(0)).toBe(false);
    expect(isExhausted(2)).toBe(false);
    expect(isExhausted(3)).toBe(true);
    expect(isExhausted(4)).toBe(true);
  });

  it("a delivery with no prior attempts is never a retry-due candidate", () => {
    expect(isRetryDue(0, 0, Date.now())).toBe(false);
  });

  it("an exhausted delivery is never a retry-due candidate", () => {
    expect(isRetryDue(3, 0, Date.now())).toBe(false);
  });

  it("retry is due once its backoff has elapsed", () => {
    expect(isRetryDue(1, 1_000, 1_000 + 60_000)).toBe(true);
    expect(isRetryDue(2, 1_000, 1_000 + 300_000)).toBe(true);
  });

  it("retry is not due before its backoff elapses", () => {
    expect(isRetryDue(1, 1_000, 1_000 + 59_999)).toBe(false);
    expect(isRetryDue(2, 1_000, 1_000 + 299_999)).toBe(false);
  });
});
