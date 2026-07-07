// TGR-09 — TelegramChannel: the real Channel implementation for reminder
// delivery. Rebuilds lost RM-04 (calmly-91t.4) on top of TGR-03's
// outbound substrate (sendMessage persists the row + buttons, retries,
// classifies blocked/failed) and TGR-08's Channel/router contracts.
//
// This is the first production caller of outbound.sendMessage — /now,
// /today, /inbox reply directly via bot.api.sendMessage instead (see
// dispatcher.ts) since they don't need buttons or delivery persistence.
//
// Rule/task lookups are done here rather than widened onto
// ChannelDeliveryInput (TGR-08's channel-agnostic router contract) so
// desktop's channel (TGR-10) isn't forced to carry Telegram-only
// formatting concerns through a shared type.
import type pg from "pg";
import type { ReminderImportance } from "@calmly/shared";
import { escapeMarkdownV2 } from "../../telegram/markdown";
import {
  sendMessage,
  TelegramNotLinkedError,
  type OutboundBotClient,
} from "../../telegram/outbound";
import { TELEGRAM_CHANNEL_NAME } from "./types";
import type { Channel, ChannelDeliverResult, ChannelDeliveryInput } from "./types";

// Actions land in TGR-11 — this bead only mints the ids/payload shapes
// the buttons carry; register nothing here.
export const REMINDER_ACTION_DONE = "reminder.done";
export const REMINDER_ACTION_SNOOZE = "reminder.snooze";
export const REMINDER_ACTION_RESCHEDULE = "reminder.reschedule";

export const REMINDER_INTENT = "reminder";
export const SNOOZE_MINUTES = 10;

const NO_NEXT_STEP = "—";

export interface TelegramChannelDeps {
  pool: pg.Pool;
  /** Lazily resolved so registering this channel never requires the
   * Telegram bot to already be initialised (app.ts wires this plugin
   * before initBot — see plugin.ts). Only invoked once a delivery is
   * actually attempted, by which point a linked chat implies a
   * configured bot. */
  getBot: () => OutboundBotClient;
  /** Overridable for tests; forwarded to outbound.sendMessage. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface ReminderContent {
  importance: ReminderImportance;
  title: string;
  nextStep: string | null;
}

export class TelegramChannel implements Channel {
  readonly name = TELEGRAM_CHANNEL_NAME;

  constructor(private readonly deps: TelegramChannelDeps) {}

  async deliver(input: ChannelDeliveryInput): Promise<ChannelDeliverResult> {
    const content = await this.loadContent(input.ruleId, input.taskId);
    const { text, parseMode } = formatReminderText(content);
    const buttons = buildButtons(input.deliveryId, input.taskId);

    try {
      const result = await sendMessage(
        this.deps.pool,
        input.userId,
        { text, buttons, intent: REMINDER_INTENT, ...(parseMode ? { parseMode } : {}) },
        { bot: this.deps.getBot(), now: this.deps.now, sleep: this.deps.sleep },
      );
      if (result.status === "blocked") {
        // TGR-03's sendMessage already emitted the blocked event; nothing
        // more to do here than signal the router to try desktop next.
        return { ok: false, fallback: true };
      }
      return { ok: true, outboundMessageId: result.outboundMessageId };
    } catch (err) {
      if (err instanceof TelegramNotLinkedError) {
        return { ok: false, fallback: true };
      }
      return {
        ok: false,
        fallback: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async loadContent(ruleId: string, taskId: string): Promise<ReminderContent> {
    const ruleResult = await this.deps.pool.query<{ importance: ReminderImportance }>(
      `SELECT importance FROM reminder_rules WHERE id = $1`,
      [ruleId],
    );
    // Falls back to 'soft' if the rule vanished between scheduling and
    // dispatch (deleted mid-tick) — favors under- over over-formatting
    // rather than throwing and burning a retry attempt on a lookup.
    const importance = ruleResult.rows[0]?.importance ?? "soft";

    const taskResult = await this.deps.pool.query<{ title: string }>(
      `SELECT title FROM tasks WHERE id = $1`,
      [taskId],
    );
    const title = taskResult.rows[0]?.title ?? "Reminder";

    // Same "oldest not-done subtask" convention as /now (TGR-04's now.ts).
    const nextStepResult = await this.deps.pool.query<{ title: string }>(
      `SELECT title FROM tasks
        WHERE parent_task_id = $1
          AND deleted_at IS NULL
          AND status NOT IN ('done', 'dropped')
        ORDER BY created_at ASC
        LIMIT 1`,
      [taskId],
    );
    const nextStep = nextStepResult.rows[0]?.title ?? null;

    return { importance, title, nextStep };
  }
}

function formatReminderText(
  content: ReminderContent,
): { text: string; parseMode?: "MarkdownV2" } {
  if (content.importance === "important") {
    const next = content.nextStep ? escapeMarkdownV2(content.nextStep) : NO_NEXT_STEP;
    return {
      text: `\u{1F514} *${escapeMarkdownV2(content.title)}*\nNext: ${next}`,
      parseMode: "MarkdownV2",
    };
  }
  return { text: content.title };
}

function buildButtons(deliveryId: string, taskId: string) {
  return [
    { label: "Done", actionId: REMINDER_ACTION_DONE, payload: { deliveryId, taskId } },
    {
      label: `Snooze ${SNOOZE_MINUTES}m`,
      actionId: REMINDER_ACTION_SNOOZE,
      payload: { deliveryId, minutes: SNOOZE_MINUTES },
    },
    { label: "Reschedule", actionId: REMINDER_ACTION_RESCHEDULE, payload: { deliveryId, taskId } },
  ];
}
