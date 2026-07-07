import { describe, expect, it, vi } from "vitest";
import { ReminderScheduler } from "../scheduler";
import { ChannelRouter } from "../router";
import { FakeReminderStore } from "./fakeStore";
import type { Channel, ChannelDeliverResult } from "../channels/types";

const INTERVAL_SECONDS = 1800; // 30m
const INTERVAL_MS = INTERVAL_SECONDS * 1000;

function scriptedChannel(name: string, results: ChannelDeliverResult[]): Channel {
  const queue = [...results];
  return {
    name,
    deliver: vi.fn(async () => queue.shift() ?? queue[queue.length - 1] ?? { ok: true }),
  };
}

function alwaysOkChannel(name: string): Channel {
  return { name, deliver: vi.fn(async () => ({ ok: true })) };
}

function routerWith(telegram: Channel, desktop: Channel, linked = true): ChannelRouter {
  return new ChannelRouter({ isTelegramLinked: async () => linked, telegram, desktop });
}

describe("ReminderScheduler.tick — new fires", () => {
  it("a due rule fires exactly once", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const telegram = alwaysOkChannel("telegram");
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(telegram, alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });

    const summary = await scheduler.tick();

    expect(summary.created).toBe(1);
    expect(summary.sent).toBe(1);
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({ status: "sent", channel: "telegram" });
    expect(telegram.deliver).toHaveBeenCalledTimes(1);
  });

  it("a rule for a done task is skipped — no delivery is created", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "done", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });

    const summary = await scheduler.tick();

    expect(summary.created).toBe(0);
    expect(summary.skippedTaskDone).toBe(1);
    expect(store.deliveries).toHaveLength(0);
  });

  it("dedupes across a double tick at the same instant — only one delivery is created", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });

    await scheduler.tick();
    await scheduler.tick(); // same "now" — the rule isn't due again yet

    expect(store.deliveries).toHaveLength(1);
  });

  it("overlapping tick() calls on one scheduler share the in-flight run instead of duplicating work", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const findSpy = vi.spyOn(store, "findActiveRuleCandidates");
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });

    const [a, b] = await Promise.all([scheduler.tick(), scheduler.tick()]);

    expect(a).toBe(b);
    expect(findSpy).toHaveBeenCalledTimes(1);
    expect(store.deliveries).toHaveLength(1);
  });

  it("fallback signal routes the delivery to the second channel", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const telegram = scriptedChannel("telegram", [{ ok: false, fallback: true }]);
    const desktop = alwaysOkChannel("desktop");
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(telegram, desktop, true),
      now: () => INTERVAL_MS,
    });

    await scheduler.tick();

    expect(store.deliveries[0]).toMatchObject({ status: "sent", channel: "desktop" });
    expect(telegram.deliver).toHaveBeenCalledTimes(1);
    expect(desktop.deliver).toHaveBeenCalledTimes(1);
  });
});

describe("ReminderScheduler.tick — in-flight guard (review fix)", () => {
  // Interval floor (300s) < total retry backoff (21m): without this guard a
  // rule's next natural fire stacks a second delivery while the previous one
  // is still pending mid-retries, and the user gets two reminders back to
  // back once both dispatch.
  it("does not create a new delivery while the last one is still pending", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    // First tick: channel fails retryably, delivery stays pending.
    const failing = scriptedChannel("telegram", [{ ok: false, fallback: false }]);
    const scheduler1 = new ReminderScheduler({
      store,
      router: routerWith(failing, alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });
    await scheduler1.tick();
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({ status: "pending" });

    // A full interval later the next natural fire is due — but the previous
    // delivery is still pending, so nothing new may be created.
    const scheduler2 = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => 2 * INTERVAL_MS,
    });
    const summary = await scheduler2.tick();
    expect(summary.created).toBe(0);
    expect(summary.skippedDuplicate).toBeGreaterThanOrEqual(1);
    expect(store.deliveries).toHaveLength(1);
  });

  it("resumes firing once the last delivery reaches a terminal status", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const telegram = alwaysOkChannel("telegram");
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(telegram, alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });
    await scheduler.tick(); // delivery 1: sent
    const scheduler2 = new ReminderScheduler({
      store,
      router: routerWith(telegram, alwaysOkChannel("desktop")),
      now: () => 2 * INTERVAL_MS,
    });
    const summary = await scheduler2.tick();
    expect(summary.created).toBe(1);
    expect(store.deliveries).toHaveLength(2);
  });
});

describe("ReminderScheduler.tick — retries", () => {
  it("retries on 1m/5m/15m backoff and marks the delivery failed after 3 attempts", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    const telegram = scriptedChannel("telegram", [
      { ok: false, error: "1" },
      { ok: false, error: "2" },
      { ok: false, error: "3" },
    ]);
    let now = INTERVAL_MS;
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(telegram, alwaysOkChannel("desktop")),
      now: () => now,
    });

    // Attempt 1: created + dispatched, fails.
    const first = await scheduler.tick();
    expect(first.created).toBe(1);
    expect(store.deliveries[0]).toMatchObject({ status: "pending", attemptCount: 1 });

    // Too soon — no retry yet.
    now += 1000;
    await scheduler.tick();
    expect(store.deliveries[0]).toMatchObject({ attemptCount: 1 });

    // 1m elapsed — attempt 2 fires and fails.
    now += 60_000;
    const second = await scheduler.tick();
    expect(second.retried).toBe(1);
    expect(store.deliveries[0]).toMatchObject({ status: "pending", attemptCount: 2 });

    // 5m elapsed since attempt 2 — attempt 3 fires, fails, and exhausts retries.
    now += 300_000;
    const third = await scheduler.tick();
    expect(third.retried).toBe(1);
    expect(third.failed).toBe(1);
    expect(store.deliveries[0]).toMatchObject({ status: "failed", attemptCount: 3 });

    // No further attempts — a failed delivery isn't a retry candidate.
    now += 900_000;
    const fourth = await scheduler.tick();
    expect(fourth.retried).toBe(0);
    expect(telegram.deliver).toHaveBeenCalledTimes(3);
  });
});

describe("ReminderScheduler.tick — snooze follow-ups (TGR-11)", () => {
  it("dispatches a pending, un-attempted delivery once its scheduled_for is due", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });
    // Mimics what handleSnooze (actions.ts) creates: a delivery for a
    // future scheduled_for, deliberately never dispatched at creation time.
    store.deliveries.push({
      id: "delivery-snoozed",
      ruleId: "rule-1",
      userId: "user-1",
      taskId: "task-1",
      scheduledFor: 5_000,
      channel: "telegram",
      status: "pending",
      attemptCount: 0,
      firedAt: null,
      lastError: null,
      outboundMessageId: null,
      createdAt: 0,
      actedAt: 4_000,
      actedVia: "telegram",
    });
    const telegram = alwaysOkChannel("telegram");
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(telegram, alwaysOkChannel("desktop")),
      now: () => 5_000,
    });

    const summary = await scheduler.tick();

    expect(summary.followupDispatched).toBe(1);
    expect(summary.created).toBe(0); // no active-rule fire this tick (rule not due yet)
    expect(telegram.deliver).toHaveBeenCalledTimes(1);
    expect(store.deliveries.find((d) => d.id === "delivery-snoozed")).toMatchObject({
      status: "sent",
      attemptCount: 1,
    });
  });

  it("does not dispatch a followup that isn't due yet", async () => {
    const store = new FakeReminderStore();
    store.deliveries.push({
      id: "delivery-snoozed",
      ruleId: "rule-1",
      userId: "user-1",
      taskId: "task-1",
      scheduledFor: 10_000,
      channel: "desktop",
      status: "pending",
      attemptCount: 0,
      firedAt: null,
      lastError: null,
      outboundMessageId: null,
      createdAt: 0,
      actedAt: 1_000,
      actedVia: "desktop",
    });
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => 5_000,
    });

    const summary = await scheduler.tick();

    expect(summary.followupDispatched).toBe(0);
    expect(store.deliveries[0]).toMatchObject({ status: "pending", attemptCount: 0 });
  });
});

describe("ReminderScheduler.stop — graceful shutdown", () => {
  it("waits for an in-flight tick to finish, and a fresh scheduler over the same store doesn't duplicate it", async () => {
    const store = new FakeReminderStore();
    store.addTask({ id: "task-1", status: "open", deletedAt: null });
    store.addRule({
      id: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      intervalSeconds: INTERVAL_SECONDS,
      active: true,
      updatedAt: 0,
      deletedAt: null,
    });

    // A channel whose deliver() only resolves once released, so the tick
    // is still "in flight" when stop() is called — simulating a SIGTERM
    // arriving mid-dispatch.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const telegram: Channel = {
      name: "telegram",
      deliver: vi.fn(async () => {
        await gate;
        return { ok: true };
      }),
    };
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(telegram, alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });

    const tickPromise = scheduler.tick();
    const stopPromise = scheduler.stop();
    release?.();
    await Promise.all([tickPromise, stopPromise]);

    // The in-flight tick ran to completion (not aborted mid-dispatch).
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({ status: "sent" });

    // "Restart": a brand-new scheduler instance over the SAME (persisted)
    // store must not duplicate the delivery just because the old
    // scheduler's in-memory state is gone.
    const restarted = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });
    await restarted.tick();

    expect(store.deliveries).toHaveLength(1);
  });

  it("a stopped scheduler no-ops on further tick() calls", async () => {
    const store = new FakeReminderStore();
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
    });
    await scheduler.stop();
    const summary = await scheduler.tick();
    expect(summary.created).toBe(0);
  });
});

describe("ReminderScheduler.tick — performance", () => {
  it("processes 1000 due rules in under a second", async () => {
    const store = new FakeReminderStore();
    for (let i = 0; i < 1000; i++) {
      const taskId = `task-${i}`;
      store.addTask({ id: taskId, status: "open", deletedAt: null });
      store.addRule({
        id: `rule-${i}`,
        taskId,
        userId: `user-${i}`,
        intervalSeconds: INTERVAL_SECONDS,
        active: true,
        updatedAt: 0,
        deletedAt: null,
      });
    }
    const scheduler = new ReminderScheduler({
      store,
      router: routerWith(alwaysOkChannel("telegram"), alwaysOkChannel("desktop")),
      now: () => INTERVAL_MS,
    });

    const start = Date.now();
    const summary = await scheduler.tick();
    const elapsed = Date.now() - start;

    expect(summary.created).toBe(1000);
    expect(summary.sent).toBe(1000);
    expect(elapsed).toBeLessThan(1000);
  });
});
