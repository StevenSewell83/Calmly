// TGR-11 — wires actions.ts's core Done/Snooze/Reschedule handlers to
// TGR-03's Telegram callback registry (telegram/actions.ts) and renders
// their result as edited/sent Telegram messages via TGR-03's outbound
// substrate. This is the first production caller of registerAction —
// actions.ts's callback.test.ts exercised the plumbing with throwaway
// actionIds only.
import type pg from "pg";
import { registerAction, type ActionContext, type ActionResult } from "../telegram/actions";
import { editMessage, sendMessage, type OutboundBotClient } from "../telegram/outbound";
import {
  REMINDER_ACTION_DONE,
  REMINDER_ACTION_SNOOZE,
  REMINDER_ACTION_RESCHEDULE,
  REMINDER_INTENT,
} from "./channels/telegram";
import { TELEGRAM_CHANNEL_NAME } from "./channels/types";
import {
  handleDone,
  handleReschedule,
  handleRescheduleChip,
  handleSnooze,
  type RescheduleChipKind,
} from "./actions";
import type { ReminderActionStore } from "./actionsStore";

const EXPIRED_TEXT = "This button expired.";
const CUSTOM_ON_DESKTOP_TEXT = "Open the app to pick a date.";

// callback_data is `<actionId>:<rowId>` capped at 64 bytes (see
// outbound.ts) — these stay well under the ~27-byte budget a uuid rowId
// leaves.
const CHIP_ACTION_IDS: Record<RescheduleChipKind, string> = {
  today_evening: "reminder.chip.evening",
  tomorrow: "reminder.chip.tomorrow",
  in_2_days: "reminder.chip.in_2_days",
};
const REMINDER_CHIP_CUSTOM = "reminder.chip.custom";

export interface ReminderActionsDeps {
  pool: pg.Pool;
  store: ReminderActionStore;
  getBot: () => OutboundBotClient;
  now?: () => number;
}

interface DonePayload {
  deliveryId?: string;
}
interface SnoozePayload {
  deliveryId?: string;
  minutes?: number;
}
interface ReschedulePayload {
  deliveryId?: string;
  taskId?: string;
}
interface ChipPayload {
  taskId?: string;
  taskTitle?: string;
}

export function registerReminderActions(deps: ReminderActionsDeps): void {
  const now = deps.now ?? Date.now;
  const bot = () => deps.getBot();

  registerAction(REMINDER_ACTION_DONE, async (ctx: ActionContext): Promise<ActionResult> => {
    const payload = ctx.payload as DonePayload | undefined;
    if (!payload?.deliveryId) return { answerText: EXPIRED_TEXT };
    const result = await handleDone(deps.store, {
      deliveryId: payload.deliveryId,
      userId: ctx.userId,
      actorSurface: TELEGRAM_CHANNEL_NAME,
      now: now(),
    });
    if (!result.ok) return { answerText: EXPIRED_TEXT };
    if (!result.alreadyActed) {
      await editMessage(
        deps.pool,
        ctx.outboundMessageId,
        { text: `Done ✓ ${result.taskTitle}` },
        { bot: bot() },
      );
    }
    return { answerText: result.alreadyActed ? "Already marked done." : "Marked done." };
  });

  registerAction(REMINDER_ACTION_SNOOZE, async (ctx: ActionContext): Promise<ActionResult> => {
    const payload = ctx.payload as SnoozePayload | undefined;
    if (!payload?.deliveryId) return { answerText: EXPIRED_TEXT };
    const result = await handleSnooze(deps.store, {
      deliveryId: payload.deliveryId,
      userId: ctx.userId,
      actorSurface: TELEGRAM_CHANNEL_NAME,
      now: now(),
      minutes: payload.minutes,
    });
    if (!result.ok) return { answerText: EXPIRED_TEXT };
    if (!result.alreadyActed && result.snoozedUntil !== null) {
      await editMessage(
        deps.pool,
        ctx.outboundMessageId,
        { text: `Snoozed until ${formatHHmmUtc(result.snoozedUntil)} — ${result.taskTitle}` },
        { bot: bot() },
      );
    }
    return { answerText: result.alreadyActed ? "Already snoozed." : "Snoozed." };
  });

  registerAction(REMINDER_ACTION_RESCHEDULE, async (ctx: ActionContext): Promise<ActionResult> => {
    const payload = ctx.payload as ReschedulePayload | undefined;
    if (!payload?.deliveryId || !payload.taskId) return { answerText: EXPIRED_TEXT };
    const result = await handleReschedule(deps.store, {
      deliveryId: payload.deliveryId,
      userId: ctx.userId,
      actorSurface: TELEGRAM_CHANNEL_NAME,
      now: now(),
    });
    if (!result.ok) return { answerText: EXPIRED_TEXT };
    if (!result.alreadyActed) {
      await editMessage(
        deps.pool,
        ctx.outboundMessageId,
        { text: `Reschedule — ${result.taskTitle}` },
        { bot: bot() },
      );
      await sendMessage(
        deps.pool,
        ctx.userId,
        {
          text: `When should I remind you about "${result.taskTitle}"?`,
          buttons: buildChipButtons(payload.taskId, result.taskTitle),
          intent: REMINDER_INTENT,
        },
        { bot: bot() },
      );
    }
    return { answerText: result.alreadyActed ? "Already handled." : "Pick a new time." };
  });

  for (const kind of Object.keys(CHIP_ACTION_IDS) as RescheduleChipKind[]) {
    registerAction(CHIP_ACTION_IDS[kind], async (ctx: ActionContext): Promise<ActionResult> => {
      const payload = ctx.payload as ChipPayload | undefined;
      if (!payload?.taskId) return { answerText: EXPIRED_TEXT };
      const { dueAt } = await handleRescheduleChip(deps.store, {
        taskId: payload.taskId,
        userId: ctx.userId,
        kind,
        now: now(),
      });
      const title = payload.taskTitle ?? "Reminder";
      await editMessage(
        deps.pool,
        ctx.outboundMessageId,
        { text: `Rescheduled to ${formatDateUtc(dueAt)} ${formatHHmmUtc(dueAt)} — ${title}` },
        { bot: bot() },
      );
      return { answerText: "Rescheduled." };
    });
  }

  registerAction(REMINDER_CHIP_CUSTOM, (): ActionResult => ({
    answerText: CUSTOM_ON_DESKTOP_TEXT,
    showAlert: true,
  }));
}

function buildChipButtons(taskId: string, taskTitle: string) {
  const chips = [
    { kind: "today_evening" as const, label: "Today evening" },
    { kind: "tomorrow" as const, label: "Tomorrow" },
    { kind: "in_2_days" as const, label: "In 2 days" },
  ];
  return [
    ...chips.map((chip) => ({
      label: chip.label,
      actionId: CHIP_ACTION_IDS[chip.kind],
      payload: { taskId, taskTitle },
    })),
    { label: "Custom", actionId: REMINDER_CHIP_CUSTOM, payload: {} },
  ];
}

function formatHHmmUtc(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function formatDateUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
