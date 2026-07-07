// TGR-10 — pure staleness-split tests for the desktop pending-deliveries
// endpoint. No Postgres needed: partitionByStaleness is the JS-side rule,
// pgDesktopDeliveryStore's SELECT/UPDATE is exercised by the docker-gated
// integration suite (reminders.integration.test.ts) alongside auth/ownership.
import { describe, expect, it } from "vitest";
import {
  DESKTOP_STALENESS_MS,
  partitionByStaleness,
  type DesktopDeliveryCandidate,
} from "../desktopDeliveries";

function candidate(overrides: Partial<DesktopDeliveryCandidate> = {}): DesktopDeliveryCandidate {
  return {
    id: "d1",
    taskId: "t1",
    taskTitle: "Buy milk",
    importance: "soft",
    scheduledFor: 1_000,
    firedAt: 1_000,
    ...overrides,
  };
}

describe("partitionByStaleness", () => {
  it("keeps a delivery fired well within the 30-minute window", () => {
    const now = 1_000 + 5 * 60_000; // 5 minutes old
    const { fresh, staleIds } = partitionByStaleness([candidate()], now);
    expect(staleIds).toEqual([]);
    expect(fresh).toEqual([
      { id: "d1", taskId: "t1", taskTitle: "Buy milk", importance: "soft", scheduledFor: 1_000 },
    ]);
  });

  it("marks a delivery older than 30 minutes as stale", () => {
    const now = 1_000 + DESKTOP_STALENESS_MS + 1;
    const { fresh, staleIds } = partitionByStaleness([candidate()], now);
    expect(fresh).toEqual([]);
    expect(staleIds).toEqual(["d1"]);
  });

  it("treats exactly the 30-minute boundary as still fresh (age > threshold, not >=)", () => {
    const now = 1_000 + DESKTOP_STALENESS_MS;
    const { fresh, staleIds } = partitionByStaleness([candidate()], now);
    expect(staleIds).toEqual([]);
    expect(fresh).toHaveLength(1);
  });

  it("treats a delivery with no fired_at yet as fresh regardless of now", () => {
    const now = 1_000 + DESKTOP_STALENESS_MS * 10;
    const { fresh, staleIds } = partitionByStaleness([candidate({ firedAt: null })], now);
    expect(staleIds).toEqual([]);
    expect(fresh).toHaveLength(1);
  });

  it("defaults to soft/Reminder when the rule or task row is gone", () => {
    const { fresh } = partitionByStaleness(
      [candidate({ taskTitle: null, importance: null })],
      1_000,
    );
    expect(fresh).toEqual([
      { id: "d1", taskId: "t1", taskTitle: "Reminder", importance: "soft", scheduledFor: 1_000 },
    ]);
  });

  it("partitions a mixed batch correctly", () => {
    const now = 1_000 + DESKTOP_STALENESS_MS + 1;
    const rows = [
      candidate({ id: "fresh-1", firedAt: now - 60_000 }),
      candidate({ id: "stale-1", firedAt: 1_000 }),
      candidate({ id: "fresh-2", firedAt: null }),
    ];
    const { fresh, staleIds } = partitionByStaleness(rows, now);
    expect(staleIds).toEqual(["stale-1"]);
    expect(fresh.map((d) => d.id)).toEqual(["fresh-1", "fresh-2"]);
  });
});
