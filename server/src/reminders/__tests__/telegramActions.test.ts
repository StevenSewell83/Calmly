// TGR-11 — unit tests for telegramActions.ts's registerReminderActions:
// exercises the exact Telegram wiring (registerAction + outbound
// send/edit) via TGR-03's real callback dispatch path, with pg + the bot
// client mocked the same way outbound.test.ts does.
import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { registerReminderActions } from "../telegramActions";
import { getAction, __INTERNAL as ActionsInternal } from "../../telegram/actions";
import type { OutboundBotClient } from "../../telegram/outbound";
import { FakeReminderStore } from "./fakeStore";
import { FakeReminderActionStore } from "./fakeActionStore";

const USER_ID = "user-1";
const CHAT_ID = "chat-42";
const RULE_ID = "rule-1";
const TASK_ID = "task-1";
const DELIVERY_ID = "delivery-1";
const OUTBOUND_ID = "outbound-1";
const NOW = 1_730_000_000_000;

function makeMockPool(): pg.Pool {
  return {
    async query(sql: string) {
      if (/FROM telegram_links/.test(sql)) {
        return { rows: [{ chat_id: CHAT_ID, linked_at: "1" }] };
      }
      if (/SELECT user_id, chat_id, telegram_message_id/.test(sql)) {
        return { rows: [{ user_id: USER_ID, chat_id: CHAT_ID, telegram_message_id: "555", intent: "reminder" }] };
      }
      // INSERT/UPDATE outbound_messages — no rows needed by either caller.
      return { rows: [] };
    },
  } as unknown as pg.Pool;
}

function makeBot(): { bot: OutboundBotClient; sendMessageMock: ReturnType<typeof vi.fn>; editMessageTextMock: ReturnType<typeof vi.fn> } {
  const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 999 });
  const editMessageTextMock = vi.fn().mockResolvedValue(true);
  return {
    bot: { api: { sendMessage: sendMessageMock, editMessageText: editMessageTextMock } },
    sendMessageMock,
    editMessageTextMock,
  };
}

function makeStores() {
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
    channel: "telegram",
    status: "sent",
    attemptCount: 1,
    firedAt: NOW - 1000,
    lastError: null,
    outboundMessageId: OUTBOUND_ID,
    createdAt: NOW - 2000,
    actedAt: null,
    actedVia: null,
  });
  const actionStore = new FakeReminderActionStore(db);
  return { db, actionStore };
}

function ctxFor(actionId: string, payload: unknown) {
  return {
    userId: USER_ID,
    chatId: CHAT_ID,
    outboundMessageId: OUTBOUND_ID,
    actionId,
    payload,
    callbackQueryId: "cq-1",
  };
}

afterEach(() => {
  ActionsInternal.clear();
});

describe("registerReminderActions", () => {
  it("Done: edits the message to 'Done ✓ <title>' with no buttons", async () => {
    const { actionStore } = makeStores();
    const { bot, editMessageTextMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });

    const handler = getAction("reminder.done")!;
    const result = await handler(ctxFor("reminder.done", { deliveryId: DELIVERY_ID }));

    expect(editMessageTextMock).toHaveBeenCalledWith(
      CHAT_ID,
      555,
      "Done ✓ Buy milk",
      { reply_markup: { inline_keyboard: [] } },
    );
    expect(result).toMatchObject({ answerText: "Marked done." });
  });

  it("Done pressed twice → second press does not edit again", async () => {
    const { actionStore } = makeStores();
    const { bot, editMessageTextMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });
    const handler = getAction("reminder.done")!;

    await handler(ctxFor("reminder.done", { deliveryId: DELIVERY_ID }));
    const second = await handler(ctxFor("reminder.done", { deliveryId: DELIVERY_ID }));

    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ answerText: "Already marked done." });
  });

  it("Snooze: edits the message to 'Snoozed until HH:mm — <title>'", async () => {
    const { actionStore } = makeStores();
    const { bot, editMessageTextMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });

    const handler = getAction("reminder.snooze")!;
    await handler(ctxFor("reminder.snooze", { deliveryId: DELIVERY_ID, minutes: 10 }));

    const expectedUntil = new Date(NOW + 10 * 60_000);
    const hh = String(expectedUntil.getUTCHours()).padStart(2, "0");
    const mm = String(expectedUntil.getUTCMinutes()).padStart(2, "0");
    expect(editMessageTextMock).toHaveBeenCalledWith(
      CHAT_ID,
      555,
      `Snoozed until ${hh}:${mm} — Buy milk`,
      { reply_markup: { inline_keyboard: [] } },
    );
  });

  it("Reschedule: clears the original message's buttons and sends a follow-up with date chips", async () => {
    const { actionStore } = makeStores();
    const { bot, editMessageTextMock, sendMessageMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });

    const handler = getAction("reminder.reschedule")!;
    await handler(ctxFor("reminder.reschedule", { deliveryId: DELIVERY_ID, taskId: TASK_ID }));

    expect(editMessageTextMock).toHaveBeenCalledWith(
      CHAT_ID,
      555,
      "Reschedule — Buy milk",
      { reply_markup: { inline_keyboard: [] } },
    );
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
    const [, , other] = sendMessageMock.mock.calls[0] as [
      unknown,
      unknown,
      { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } },
    ];
    const labels = other.reply_markup.inline_keyboard.map((row) => row[0]!.text);
    expect(labels).toEqual(["Today evening", "Tomorrow", "In 2 days", "Custom"]);
  });

  it("Reschedule chip: reschedules the task's due date and edits the follow-up message", async () => {
    const { actionStore } = makeStores();
    actionStore.addTask({ id: TASK_ID, userId: USER_ID, dueAt: null, deletedAt: null });
    const { bot, editMessageTextMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });

    const handler = getAction("reminder.chip.tomorrow")!;
    await handler(ctxFor("reminder.chip.tomorrow", { taskId: TASK_ID, taskTitle: "Buy milk" }));

    expect(actionStore.rescheduledTasks.get(TASK_ID)?.dueAt).not.toBeNull();
    expect(editMessageTextMock).toHaveBeenCalledTimes(1);
    const [, , text] = editMessageTextMock.mock.calls[0] as [unknown, unknown, string];
    expect(text).toContain("Buy milk");
  });

  it("Custom chip → tells the user to open the app, touches no state", async () => {
    const { actionStore } = makeStores();
    const { bot, editMessageTextMock, sendMessageMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });

    const handler = getAction("reminder.chip.custom")!;
    const result = await handler(ctxFor("reminder.chip.custom", {}));

    expect(result).toEqual({ answerText: "Open the app to pick a date.", showAlert: true });
    expect(editMessageTextMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("missing deliveryId in payload → answered as expired, no DB/telegram calls", async () => {
    const { actionStore } = makeStores();
    const { bot, editMessageTextMock } = makeBot();
    registerReminderActions({ pool: makeMockPool(), store: actionStore, getBot: () => bot, now: () => NOW });

    const handler = getAction("reminder.done")!;
    const result = await handler(ctxFor("reminder.done", {}));

    expect(result).toEqual({ answerText: "This button expired." });
    expect(editMessageTextMock).not.toHaveBeenCalled();
  });
});
