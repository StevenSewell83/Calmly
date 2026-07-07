// TGR-09 — TelegramChannel tests. outbound.ts's sendMessage is mocked
// (same importOriginal-preserving-error-classes pattern as
// handlers/__tests__/voice.test.ts's files.ts mock) so these specs
// exercise this channel's own logic — formatting, button payload shapes,
// and how it maps outbound.ts's outcomes/errors onto ChannelDeliverResult
// — without going through the real pg-backed sendMessage (already
// covered by telegram/__tests__/outbound.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import type { ChannelDeliveryInput } from "../types";
import type { OutboundBotClient, SendMessageResult } from "../../../telegram/outbound";

const mockSendMessage = vi.fn();

vi.mock("../../../telegram/outbound", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../telegram/outbound")>();
  return {
    ...actual,
    sendMessage: (
      pool: unknown,
      userId: unknown,
      input: unknown,
      deps: unknown,
    ): Promise<SendMessageResult> => mockSendMessage(pool, userId, input, deps),
  };
});

const {
  TelegramChannel,
  REMINDER_ACTION_DONE,
  REMINDER_ACTION_SNOOZE,
  REMINDER_ACTION_RESCHEDULE,
  REMINDER_INTENT,
  SNOOZE_MINUTES,
} = await import("../telegram");
const { TelegramNotLinkedError } = await import("../../../telegram/outbound");

const INPUT: ChannelDeliveryInput = {
  deliveryId: "delivery-1",
  ruleId: "rule-1",
  userId: "user-1",
  taskId: "task-1",
  scheduledFor: 1_000,
};

interface QueryCall {
  sql: string;
  params: readonly unknown[] | undefined;
}

function makeMockPool(opts: {
  importance?: "important" | "soft" | null;
  title?: string | null;
  nextStep?: string | null;
}): { pool: pg.Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const pool = {
    async query(sql: string, params?: readonly unknown[]) {
      calls.push({ sql, params });
      if (/FROM reminder_rules/.test(sql)) {
        return { rows: opts.importance ? [{ importance: opts.importance }] : [] };
      }
      if (/parent_task_id/.test(sql)) {
        return { rows: opts.nextStep ? [{ title: opts.nextStep }] : [] };
      }
      if (/FROM tasks/.test(sql)) {
        return { rows: opts.title ? [{ title: opts.title }] : [] };
      }
      throw new Error(`no mock handler for query: ${sql}`);
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

const fakeBot = {} as OutboundBotClient;

function makeChannel(pool: pg.Pool) {
  return new TelegramChannel({ pool, getBot: () => fakeBot });
}

beforeEach(() => {
  mockSendMessage.mockReset();
});

describe("TelegramChannel.deliver — Important formatting", () => {
  it("bolds the escaped title and includes the escaped next step", async () => {
    mockSendMessage.mockResolvedValue({
      outboundMessageId: "m1",
      status: "sent",
      telegramMessageId: 1,
    });
    const { pool } = makeMockPool({
      importance: "important",
      title: "Buy milk!",
      nextStep: "Get eggs.",
    });

    await makeChannel(pool).deliver(INPUT);

    const [, , input] = mockSendMessage.mock.calls[0] as [unknown, unknown, { text: string; parseMode?: string }];
    expect(input.text).toBe("🔔 *Buy milk\\!*\nNext: Get eggs\\.");
    expect(input.parseMode).toBe("MarkdownV2");
  });

  it("uses the em-dash placeholder when there is no next step", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m1", status: "sent", telegramMessageId: 1 });
    const { pool } = makeMockPool({ importance: "important", title: "Buy milk", nextStep: null });

    await makeChannel(pool).deliver(INPUT);

    const [, , input] = mockSendMessage.mock.calls[0] as [unknown, unknown, { text: string }];
    expect(input.text).toBe("🔔 *Buy milk*\nNext: —");
  });
});

describe("TelegramChannel.deliver — Soft formatting", () => {
  it("sends the plain title with no markdown escaping or parseMode", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m1", status: "sent", telegramMessageId: 1 });
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk!", nextStep: "Get eggs" });

    await makeChannel(pool).deliver(INPUT);

    const [, , input] = mockSendMessage.mock.calls[0] as [unknown, unknown, { text: string; parseMode?: string }];
    expect(input.text).toBe("Buy milk!");
    expect(input.parseMode).toBeUndefined();
  });
});

describe("TelegramChannel.deliver — button payloads", () => {
  it("builds Done / Snooze / Reschedule buttons with the exact actionIds and payloads", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m1", status: "sent", telegramMessageId: 1 });
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk" });

    await makeChannel(pool).deliver(INPUT);

    const [, , input] = mockSendMessage.mock.calls[0] as [
      unknown,
      unknown,
      { buttons: { label: string; actionId: string; payload: unknown }[] },
    ];
    expect(input.buttons).toEqual([
      { label: "Done", actionId: REMINDER_ACTION_DONE, payload: { deliveryId: "delivery-1", taskId: "task-1" } },
      {
        label: `Snooze ${SNOOZE_MINUTES}m`,
        actionId: REMINDER_ACTION_SNOOZE,
        payload: { deliveryId: "delivery-1", minutes: SNOOZE_MINUTES },
      },
      {
        label: "Reschedule",
        actionId: REMINDER_ACTION_RESCHEDULE,
        payload: { deliveryId: "delivery-1", taskId: "task-1" },
      },
    ]);
  });

  it("sends with the 'reminder' intent", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m1", status: "sent", telegramMessageId: 1 });
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk" });

    await makeChannel(pool).deliver(INPUT);

    const [, , input] = mockSendMessage.mock.calls[0] as [unknown, unknown, { intent?: string }];
    expect(input.intent).toBe(REMINDER_INTENT);
  });
});

describe("TelegramChannel.deliver — outcome mapping", () => {
  it("unlinked user → {ok:false, fallback:true}, no fallback send attempted by this channel", async () => {
    mockSendMessage.mockRejectedValue(new TelegramNotLinkedError(INPUT.userId));
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk" });

    const result = await makeChannel(pool).deliver(INPUT);

    expect(result).toEqual({ ok: false, fallback: true });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it("blocked (403) → {ok:false, fallback:true}, relies on TGR-03's blocked event (not re-emitted here)", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m1", status: "blocked", telegramMessageId: null });
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk" });

    const result = await makeChannel(pool).deliver(INPUT);

    expect(result).toEqual({ ok: false, fallback: true });
  });

  it("other (retryable) send failure → {ok:false, fallback:false} with the error message, so the scheduler retries", async () => {
    mockSendMessage.mockRejectedValue(new Error("sending outbound message m1 failed after retries"));
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk" });

    const result = await makeChannel(pool).deliver(INPUT);

    expect(result).toEqual({
      ok: false,
      fallback: false,
      error: "sending outbound message m1 failed after retries",
    });
  });

  it("success → {ok:true, outboundMessageId} so the scheduler can persist it on the delivery row", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m-persisted", status: "sent", telegramMessageId: 42 });
    const { pool } = makeMockPool({ importance: "soft", title: "Buy milk" });

    const result = await makeChannel(pool).deliver(INPUT);

    expect(result).toEqual({ ok: true, outboundMessageId: "m-persisted" });
  });
});

describe("TelegramChannel.deliver — defensive fallbacks", () => {
  it("defaults to soft importance and a placeholder title when the rule/task row is gone", async () => {
    mockSendMessage.mockResolvedValue({ outboundMessageId: "m1", status: "sent", telegramMessageId: 1 });
    const { pool } = makeMockPool({});

    await makeChannel(pool).deliver(INPUT);

    const [, , input] = mockSendMessage.mock.calls[0] as [unknown, unknown, { text: string; parseMode?: string }];
    expect(input.text).toBe("Reminder");
    expect(input.parseMode).toBeUndefined();
  });
});
