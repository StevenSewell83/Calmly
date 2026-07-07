// TGR-12 — whole-engine lifecycle proof, end to end with a virtual clock:
// rule -> scheduled dispatch -> channel -> action -> rescheduled fire, on
// both channels. Rebuilds lost RM-08 (calmly-91t.8); this is the epic's
// exit gate.
//
// Unlike reminders.integration.test.ts (real Postgres via testcontainers,
// docker-gated, skips in this container — see agent-common.md), this suite
// deliberately runs with NO Docker dependency: FakeReminderStore /
// FakeReminderActionStore (TGR-08/11's existing in-memory fakes) stand in
// for the DB tables the scheduler and action handlers touch, and
// LifecycleTelegramPool (this dir) stands in for the handful of raw-SQL
// queries TelegramChannel / outbound.ts / handleCallbackQuery make directly
// (telegram_links, outbound_messages, reminder_rules, tasks). The real
// production classes (ReminderScheduler, ChannelRouter, TelegramChannel,
// DesktopChannel, registerReminderActions, handleCallbackQuery) all run
// unmodified against these fakes — only the persistence layer is faked, so
// this exercises the exact wiring a Postgres-backed run would. Time is a
// plain mutable `clock.now` closure (same precedent as scheduler.test.ts),
// not vi.useFakeTimers, since nothing here schedules real timers other than
// outbound.ts's retry backoff — which is bypassed via `sleep: async () => {}`.
//
// MockTelegramBotApi (TG-09a) + telegramUpdates.ts (TG-09b) drive the
// Telegram surface: buttons are pressed by extracting `callback_data`
// (`<actionId>:<outboundMessageId>`) straight off the recorded sendMessage/
// editMessageText calls and replaying it through the real
// handleCallbackQuery dispatcher, same path a live webhook update takes.
import { afterEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { FastifyBaseLogger } from "fastify";
import type { InlineKeyboardMarkup } from "@grammyjs/types";
import { ReminderScheduler } from "../scheduler";
import { ChannelRouter } from "../router";
import { TelegramChannel } from "../channels/telegram";
import { DesktopChannel } from "../channels/desktop";
import { registerReminderActions } from "../telegramActions";
import {
  handleCallbackQuery,
  type CallbackBotClient,
} from "../../telegram/handlers/callback";
import { __INTERNAL as ActionsInternal } from "../../telegram/actions";
import type { OutboundBotClient } from "../../telegram/outbound";
import { FakeReminderStore } from "./fakeStore";
import { FakeReminderActionStore } from "./fakeActionStore";
import {
  MockTelegramBotApi,
  type RecordedCall,
} from "../../test-utils/telegramBotMock";
import { makeCallbackQueryUpdate } from "../../test-utils/telegramUpdates";
import { LifecycleTelegramPool } from "./lifecycleTelegramPool";

const NOW0 = 1_730_000_000_000;
const INTERVAL_10M_S = 600; // 10 minutes, matches the bead's escalation spec
const TEN_MINUTES_MS = 10 * 60_000;

function makeStubLogger(): FastifyBaseLogger {
  const noop = (): void => {};
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => logger,
    level: "info",
    silent: noop,
  } as unknown as FastifyBaseLogger;
  return logger;
}

interface Harness {
  store: FakeReminderStore;
  actionStore: FakeReminderActionStore;
  pool: LifecycleTelegramPool;
  telegramBot: MockTelegramBotApi;
  scheduler: ReminderScheduler;
  clock: { now: number };
  press(actionId: string, outboundMessageId: string): Promise<void>;
}

function makeHarness(startNow = NOW0): Harness {
  const store = new FakeReminderStore();
  const actionStore = new FakeReminderActionStore(store);
  const pool = new LifecycleTelegramPool();
  const telegramBot = new MockTelegramBotApi();
  const clock = { now: startNow };
  const bot = { api: telegramBot.api } as unknown as OutboundBotClient;

  const telegram = new TelegramChannel({
    pool: pool as unknown as pg.Pool,
    getBot: () => bot,
    now: () => clock.now,
    sleep: async () => {},
  });
  const desktop = new DesktopChannel({ info: () => {} });
  const router = new ChannelRouter({
    isTelegramLinked: async (userId) => pool.linkedUsers.has(userId),
    telegram,
    desktop,
  });
  const scheduler = new ReminderScheduler({
    store,
    router,
    now: () => clock.now,
  });

  registerReminderActions({
    pool: pool as unknown as pg.Pool,
    store: actionStore,
    getBot: () => bot,
    now: () => clock.now,
  });

  const log = makeStubLogger();
  const callbackBot = { api: telegramBot.api } as unknown as CallbackBotClient;

  async function press(
    actionId: string,
    outboundMessageId: string,
  ): Promise<void> {
    const update = makeCallbackQueryUpdate(`${actionId}:${outboundMessageId}`);
    await handleCallbackQuery(
      update.callback_query!,
      pool as unknown as pg.Pool,
      log,
      {
        bot: callbackBot,
      },
    );
  }

  return { store, actionStore, pool, telegramBot, scheduler, clock, press };
}

function seedRule(
  h: Harness,
  opts: {
    ruleId: string;
    taskId: string;
    userId: string;
    title: string;
    intervalSeconds: number;
    importance?: "important" | "soft";
    linked?: boolean;
  },
): void {
  h.store.addTask({
    id: opts.taskId,
    status: "open",
    deletedAt: null,
    title: opts.title,
  });
  h.store.addRule({
    id: opts.ruleId,
    taskId: opts.taskId,
    userId: opts.userId,
    intervalSeconds: opts.intervalSeconds,
    active: true,
    updatedAt: h.clock.now,
    deletedAt: null,
  });
  h.pool.setTask(opts.taskId, opts.title);
  h.pool.setRule(opts.ruleId, opts.importance ?? "soft");
  if (opts.linked ?? true) h.pool.linkUser(opts.userId, `chat-${opts.userId}`);
}

function sendMessageCalls(
  bot: MockTelegramBotApi,
): Extract<RecordedCall, { method: "sendMessage" }>[] {
  return bot.outbound.filter(
    (c): c is Extract<RecordedCall, { method: "sendMessage" }> =>
      c.method === "sendMessage",
  );
}

function editCalls(
  bot: MockTelegramBotApi,
): Extract<RecordedCall, { method: "editMessageText" }>[] {
  return bot.outbound.filter(
    (c): c is Extract<RecordedCall, { method: "editMessageText" }> =>
      c.method === "editMessageText",
  );
}

// Extracts the `<actionId>:<outboundMessageId>` callback_data for a given
// button label's actionId off a recorded sendMessage/editMessageText call,
// so a spec can press a button that was just rendered without reaching
// into LifecycleTelegramPool's internals.
function rowIdForAction(call: RecordedCall, actionId: string): string {
  if (call.method !== "sendMessage" && call.method !== "editMessageText") {
    throw new Error(
      `rowIdForAction: ${call.method} calls carry no reply_markup`,
    );
  }
  const markup = call.other?.reply_markup as InlineKeyboardMarkup | undefined;
  if (!markup) throw new Error("rowIdForAction: call has no reply_markup");
  for (const row of markup.inline_keyboard) {
    for (const button of row) {
      if (
        "callback_data" in button &&
        button.callback_data.startsWith(`${actionId}:`)
      ) {
        return button.callback_data.slice(actionId.length + 1);
      }
    }
  }
  throw new Error(`rowIdForAction: no button for actionId "${actionId}"`);
}

afterEach(() => {
  ActionsInternal.clear();
});

describe("Reminder lifecycle — 1. rule creation -> deliveries math", () => {
  it("computes next fire as ruleUpdatedAt + interval and doesn't fire before it's due", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-1",
      taskId: "task-1",
      userId: "user-1",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
      linked: false,
    });

    h.clock.now = NOW0 + TEN_MINUTES_MS - 1_000;
    const early = await h.scheduler.tick();
    expect(early.created).toBe(0);
    expect(h.store.deliveries).toHaveLength(0);

    h.clock.now = NOW0 + TEN_MINUTES_MS;
    const due = await h.scheduler.tick();
    expect(due.created).toBe(1);
    expect(h.store.deliveries[0]).toMatchObject({
      scheduledFor: NOW0 + TEN_MINUTES_MS,
      status: "sent",
      channel: "desktop",
    });
  });
});

describe("Reminder lifecycle — 2. telegram dispatch, linked user", () => {
  it("advancing the clock to due fires exactly one sendMessage with three buttons", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-2",
      taskId: "task-2",
      userId: "user-2",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
    });

    h.clock.now += TEN_MINUTES_MS;
    const summary = await h.scheduler.tick();

    expect(summary.sent).toBe(1);
    expect(h.store.deliveries[0]).toMatchObject({
      status: "sent",
      channel: "telegram",
    });
    const sends = sendMessageCalls(h.telegramBot);
    expect(sends).toHaveLength(1);
    const markup = sends[0]!.other?.reply_markup as InlineKeyboardMarkup;
    expect(markup.inline_keyboard).toHaveLength(3);
    expect(markup.inline_keyboard.map((row) => row[0]!.text)).toEqual([
      "Done",
      "Snooze 10m",
      "Reschedule",
    ]);
  });
});

describe("Reminder lifecycle — 3. desktop fallback, unlinked user", () => {
  it("routes to the desktop channel; the telegram mock is never touched", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-3",
      taskId: "task-3",
      userId: "user-3",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
      linked: false,
    });

    h.clock.now += TEN_MINUTES_MS;
    const summary = await h.scheduler.tick();

    expect(summary.sent).toBe(1);
    expect(h.store.deliveries[0]).toMatchObject({
      status: "sent",
      channel: "desktop",
    });
    expect(h.telegramBot.outbound).toHaveLength(0);
  });
});

describe("Reminder lifecycle — 4. Done", () => {
  it("callback acks the delivery, deactivates the rule, and stops further fires", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-4",
      taskId: "task-4",
      userId: "user-4",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
    });

    h.clock.now += TEN_MINUTES_MS;
    await h.scheduler.tick();
    const delivery = h.store.deliveries[0]!;
    const outboundMessageId = delivery.outboundMessageId!;

    await h.press("reminder.done", outboundMessageId);

    expect(h.store.deliveries[0]).toMatchObject({
      status: "acked",
      actedVia: "telegram",
    });
    expect(h.store.rules.get("rule-4")).toMatchObject({ active: false });
    expect(editCalls(h.telegramBot)).toMatchObject([
      { text: "Done ✓ Buy milk" },
    ]);

    // Advance a full interval again — the rule is inactive, no new delivery.
    h.clock.now += TEN_MINUTES_MS;
    const summary = await h.scheduler.tick();
    expect(summary.created).toBe(0);
    expect(h.store.deliveries).toHaveLength(1);
  });
});

describe("Reminder lifecycle — 5. Snooze 10m", () => {
  it("creates a follow-up delivery that fires at +10m; the original message is edited", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-5",
      taskId: "task-5",
      userId: "user-5",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
    });

    h.clock.now += TEN_MINUTES_MS;
    await h.scheduler.tick();
    const outboundMessageId = h.store.deliveries[0]!.outboundMessageId!;

    await h.press("reminder.snooze", outboundMessageId);

    expect(h.store.deliveries[0]).toMatchObject({ status: "snoozed" });
    expect(h.store.deliveries).toHaveLength(2);
    expect(h.store.deliveries[1]).toMatchObject({
      status: "pending",
      channel: "telegram",
      attemptCount: 0,
    });
    const edits = editCalls(h.telegramBot);
    expect(edits).toHaveLength(1);
    expect(edits[0]!.text).toMatch(/^Snoozed until \d{2}:\d{2} — Buy milk$/);

    // Not due yet — an immediate re-tick doesn't dispatch the follow-up.
    const tooSoon = await h.scheduler.tick();
    expect(tooSoon.followupDispatched).toBe(0);

    h.clock.now += TEN_MINUTES_MS;
    const summary = await h.scheduler.tick();
    expect(summary.followupDispatched).toBe(1);
    expect(h.store.deliveries[1]).toMatchObject({ status: "sent" });
    expect(sendMessageCalls(h.telegramBot)).toHaveLength(2);
  });
});

describe("Reminder lifecycle — 6. Reschedule chip", () => {
  it("chip callback updates the task's due date and the original delivery is acked", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-6",
      taskId: "task-6",
      userId: "user-6",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
    });
    h.actionStore.addTask({
      id: "task-6",
      userId: "user-6",
      dueAt: null,
      deletedAt: null,
    });

    h.clock.now += TEN_MINUTES_MS;
    await h.scheduler.tick();
    const outboundMessageId = h.store.deliveries[0]!.outboundMessageId!;

    await h.press("reminder.reschedule", outboundMessageId);

    expect(h.store.deliveries[0]).toMatchObject({ status: "acked" });
    expect(h.store.rules.get("rule-6")).toMatchObject({ active: true }); // unlike Done
    const edits = editCalls(h.telegramBot);
    expect(edits[0]!.text).toBe("Reschedule — Buy milk");

    const chipMessage = sendMessageCalls(h.telegramBot).at(-1)!;
    const chipRowId = rowIdForAction(chipMessage, "reminder.chip.tomorrow");
    await h.press("reminder.chip.tomorrow", chipRowId);

    const rescheduled = h.actionStore.rescheduledTasks.get("task-6");
    expect(rescheduled?.dueAt).not.toBeNull();
    const edits2 = editCalls(h.telegramBot);
    expect(edits2.at(-1)!.text).toContain("Buy milk");
  });
});

describe("Reminder lifecycle — 7. important vs soft templates", () => {
  it("important is bold with a next step; soft is the plain title", async () => {
    const important = makeHarness();
    seedRule(important, {
      ruleId: "rule-7a",
      taskId: "task-7a",
      userId: "user-7a",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
      importance: "important",
    });
    important.pool.setNextStep("task-7a", "Get eggs");
    important.clock.now += TEN_MINUTES_MS;
    await important.scheduler.tick();
    const importantCall = sendMessageCalls(important.telegramBot)[0]!;
    expect(importantCall.text).toBe("\u{1F514} *Buy milk*\nNext: Get eggs");
    expect(importantCall.other?.parse_mode).toBe("MarkdownV2");

    const soft = makeHarness();
    seedRule(soft, {
      ruleId: "rule-7b",
      taskId: "task-7b",
      userId: "user-7b",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
      importance: "soft",
    });
    soft.clock.now += TEN_MINUTES_MS;
    await soft.scheduler.tick();
    const softCall = sendMessageCalls(soft.telegramBot)[0]!;
    expect(softCall.text).toBe("Buy milk");
    expect(softCall.other?.parse_mode).toBeUndefined();
  });
});

describe("Reminder lifecycle — 8. escalation/repeat", () => {
  it("an important, unacked, interval=10m rule fires exactly 3 times over 30m with no dupes within a tick", async () => {
    const h = makeHarness();
    seedRule(h, {
      ruleId: "rule-8",
      taskId: "task-8",
      userId: "user-8",
      title: "Buy milk",
      intervalSeconds: INTERVAL_10M_S,
      importance: "important",
    });

    for (let i = 0; i < 3; i++) {
      h.clock.now += TEN_MINUTES_MS;
      const first = await h.scheduler.tick();
      const second = await h.scheduler.tick(); // same instant — must not double-fire
      expect(first.created + first.followupDispatched).toBe(1);
      expect(second.created).toBe(0);
      expect(second.followupDispatched).toBe(0);
    }

    expect(sendMessageCalls(h.telegramBot)).toHaveLength(3);
    expect(h.store.deliveries).toHaveLength(3);
    expect(h.store.deliveries.every((d) => d.status === "sent")).toBe(true);
    expect(h.store.rules.get("rule-8")).toMatchObject({ active: true }); // never acked
  });
});
