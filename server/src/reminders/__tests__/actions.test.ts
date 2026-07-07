// TGR-11 — unit tests for the surface-agnostic Done/Snooze/Reschedule
// core (actions.ts), plus one cross-module integration case proving a
// snooze's follow-up delivery is actually picked up by the TGR-08
// scheduler (fake-timer style: advance a fake `now`, tick(), assert).
import { describe, expect, it } from "vitest";
import {
  computeChipDueAt,
  handleDone,
  handleReschedule,
  handleRescheduleChip,
  handleSnooze,
} from "../actions";
import { ReminderScheduler } from "../scheduler";
import { ChannelRouter } from "../router";
import { FakeReminderStore } from "./fakeStore";
import { FakeReminderActionStore } from "./fakeActionStore";
import type { Channel } from "../channels/types";
import type { DeliveryStatus } from "../state";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";
const RULE_ID = "rule-1";
const TASK_ID = "task-1";
const DELIVERY_ID = "delivery-1";
const NOW = 1_730_000_000_000;

function makeStores(overrides: { deliveryStatus?: DeliveryStatus; channel?: string } = {}) {
  const db = new FakeReminderStore();
  db.addTask({ id: TASK_ID, status: "open", deletedAt: null, title: "Buy milk" });
  db.addRule({
    id: RULE_ID,
    taskId: TASK_ID,
    userId: USER_ID,
    intervalSeconds: 1800,
    active: true,
    updatedAt: 0,
    deletedAt: null,
  });
  db.deliveries.push({
    id: DELIVERY_ID,
    ruleId: RULE_ID,
    userId: USER_ID,
    taskId: TASK_ID,
    scheduledFor: NOW - 1000,
    channel: overrides.channel ?? "telegram",
    status: overrides.deliveryStatus ?? "sent",
    attemptCount: 1,
    firedAt: NOW - 1000,
    lastError: null,
    outboundMessageId: "outbound-1",
    createdAt: NOW - 2000,
    actedAt: null,
    actedVia: null,
  });
  const actionStore = new FakeReminderActionStore(db);
  return { db, actionStore };
}

describe("handleDone", () => {
  it("acks the delivery, deactivates the rule, returns the fresh state", async () => {
    const { db, actionStore } = makeStores();

    const result = await handleDone(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "telegram",
      now: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyActed: false,
      status: "acked",
      taskId: TASK_ID,
      taskTitle: "Buy milk",
    });
    expect(db.deliveries[0]).toMatchObject({ status: "acked", actedAt: NOW, actedVia: "telegram" });
    expect(db.rules.get(RULE_ID)?.active).toBe(false);
  });

  it("second Done press on an already-acked delivery is a no-op", async () => {
    const { db, actionStore } = makeStores({ deliveryStatus: "acked" });

    const result = await handleDone(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "telegram",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, alreadyActed: true, status: "acked" });
    // Rule was never (re)deactivated a second time — no observable side effect happened.
    expect(db.rules.get(RULE_ID)?.active).toBe(true);
  });

  it("Done pressed after Reschedule already acked the same delivery is also idempotent", async () => {
    const { actionStore } = makeStores({ deliveryStatus: "acked" });

    const result = await handleDone(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "desktop",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, alreadyActed: true, status: "acked" });
  });

  it("unknown delivery id → not_found", async () => {
    const { actionStore } = makeStores();
    const result = await handleDone(actionStore, {
      deliveryId: "ghost",
      userId: USER_ID,
      actorSurface: "desktop",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("ownership: a delivery owned by someone else → not_found", async () => {
    const { actionStore } = makeStores();
    const result = await handleDone(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: OTHER_USER_ID,
      actorSurface: "desktop",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("handleSnooze", () => {
  it("snoozes the delivery and creates a follow-up delivery at now+minutes on the same channel", async () => {
    const { db, actionStore } = makeStores({ channel: "telegram" });

    const result = await handleSnooze(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "telegram",
      now: NOW,
      minutes: 15,
    });

    expect(result).toMatchObject({
      ok: true,
      alreadyActed: false,
      status: "snoozed",
      taskId: TASK_ID,
      taskTitle: "Buy milk",
      snoozedUntil: NOW + 15 * 60_000,
    });
    expect(db.deliveries[0]).toMatchObject({ status: "snoozed", actedVia: "telegram" });
    const followup = db.deliveries.find((d) => d.id !== DELIVERY_ID);
    expect(followup).toMatchObject({
      ruleId: RULE_ID,
      taskId: TASK_ID,
      channel: "telegram",
      status: "pending",
      attemptCount: 0,
      scheduledFor: NOW + 15 * 60_000,
    });
  });

  it("defaults to the channel's SNOOZE_MINUTES when minutes is omitted", async () => {
    const { actionStore } = makeStores();
    const result = await handleSnooze(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "desktop",
      now: NOW,
    });
    expect(result).toMatchObject({ snoozedUntil: NOW + 10 * 60_000 });
  });

  it("second Snooze press on an already-snoozed delivery is a no-op — no second follow-up created", async () => {
    const { db, actionStore } = makeStores({ deliveryStatus: "snoozed" });

    const result = await handleSnooze(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "telegram",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, alreadyActed: true, status: "snoozed", snoozedUntil: null });
    expect(db.deliveries).toHaveLength(1); // no follow-up delivery was created
  });

  it("unknown delivery id → not_found", async () => {
    const { actionStore } = makeStores();
    const result = await handleSnooze(actionStore, {
      deliveryId: "ghost",
      userId: USER_ID,
      actorSurface: "desktop",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("handleReschedule", () => {
  it("acks the delivery and returns the taskId for the caller to navigate to", async () => {
    const { db, actionStore } = makeStores();

    const result = await handleReschedule(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "desktop",
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true, alreadyActed: false, status: "acked", taskId: TASK_ID });
    expect(db.deliveries[0]).toMatchObject({ status: "acked", actedVia: "desktop" });
    // Reschedule does not deactivate the rule (unlike Done) — the reminder cadence continues.
    expect(db.rules.get(RULE_ID)?.active).toBe(true);
  });

  it("second Reschedule press is idempotent", async () => {
    const { actionStore } = makeStores({ deliveryStatus: "acked" });
    const result = await handleReschedule(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "telegram",
      now: NOW,
    });
    expect(result).toMatchObject({ ok: true, alreadyActed: true, status: "acked" });
  });
});

describe("computeChipDueAt", () => {
  // 2024-06-01T10:00:00Z
  const midMorningUtc = Date.UTC(2024, 5, 1, 10, 0, 0);

  it("today_evening → 18:00 UTC the same day", () => {
    expect(computeChipDueAt("today_evening", midMorningUtc)).toBe(Date.UTC(2024, 5, 1, 18, 0, 0));
  });

  it("tomorrow → 09:00 UTC the next day", () => {
    expect(computeChipDueAt("tomorrow", midMorningUtc)).toBe(Date.UTC(2024, 5, 2, 9, 0, 0));
  });

  it("in_2_days → 09:00 UTC two days ahead", () => {
    expect(computeChipDueAt("in_2_days", midMorningUtc)).toBe(Date.UTC(2024, 5, 3, 9, 0, 0));
  });
});

describe("handleRescheduleChip", () => {
  it("updates the task's due_at via the synced tasks table", async () => {
    const { actionStore } = makeStores();
    actionStore.addTask({ id: TASK_ID, userId: USER_ID, dueAt: null, deletedAt: null });

    const result = await handleRescheduleChip(actionStore, {
      taskId: TASK_ID,
      userId: USER_ID,
      kind: "tomorrow",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(actionStore.rescheduledTasks.get(TASK_ID)?.dueAt).toBe(result.dueAt);
  });

  it("ownership mismatch → ok:false, no update", async () => {
    const { actionStore } = makeStores();
    actionStore.addTask({ id: TASK_ID, userId: OTHER_USER_ID, dueAt: null, deletedAt: null });

    const result = await handleRescheduleChip(actionStore, {
      taskId: TASK_ID,
      userId: USER_ID,
      kind: "tomorrow",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    expect(actionStore.rescheduledTasks.get(TASK_ID)?.dueAt).toBeNull();
  });
});

describe("snooze -> scheduler integration (TGR-11 extends TGR-08)", () => {
  it("a snooze's follow-up delivery is dispatched by the scheduler once its time arrives", async () => {
    const { db, actionStore } = makeStores({ channel: "telegram" });
    const telegram: Channel = { name: "telegram", deliver: async () => ({ ok: true }) };
    const desktop: Channel = { name: "desktop", deliver: async () => ({ ok: true }) };

    const snoozeResult = await handleSnooze(actionStore, {
      deliveryId: DELIVERY_ID,
      userId: USER_ID,
      actorSurface: "telegram",
      now: NOW,
      minutes: 10,
    });
    if (!snoozeResult.ok) throw new Error("expected snooze to succeed");
    const snoozedUntil = snoozeResult.snoozedUntil ?? 0;

    // Same underlying FakeReminderStore backs both the action store above
    // and the scheduler below — mirroring how pgReminderActionStore and
    // pgReminderStore share one real Postgres table in production.
    const scheduler = new ReminderScheduler({
      store: db,
      router: new ChannelRouter({ isTelegramLinked: async () => true, telegram, desktop }),
      now: () => snoozedUntil - 1,
    });
    const tooEarly = await scheduler.tick();
    expect(tooEarly.followupDispatched).toBe(0);

    const onTime = new ReminderScheduler({
      store: db,
      router: new ChannelRouter({ isTelegramLinked: async () => true, telegram, desktop }),
      now: () => snoozedUntil,
    });
    const summary = await onTime.tick();

    expect(summary.followupDispatched).toBe(1);
    const followup = db.deliveries.find((d) => d.id !== DELIVERY_ID);
    expect(followup).toMatchObject({ status: "sent", scheduledFor: snoozedUntil });
  });
});
