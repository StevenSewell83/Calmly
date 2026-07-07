// TGR-11 — Done/Snooze/Reschedule: the surface-agnostic state-transition
// core. Both surfaces (Telegram callbacks — see telegramActions.ts's
// registerReminderActions — and the desktop HTTP action endpoint —
// actionRoutes.ts) call the functions below and render the result their
// own way; nothing here knows about grammy or Fastify. Rebuilds lost
// RM-06 (calmly-91t.6).
//
// PRD §4: Done acks the REMINDER, not the task. Completing the task too
// would need a UserSettings flag — none exists yet (settings_json in
// shared/src/model/settings.ts is an opaque JSONB blob with no per-key
// schema to check), so this is hardcoded reminder-only for v1; a real
// setting is a follow-up bead once UserSettings grows a typed schema.
//
// Idempotency: any action on a delivery that isn't currently 'sent' (i.e.
// already 'acked' or 'snoozed' by an earlier press, on either surface) is
// a no-op that reports the current state instead of re-running side
// effects — covers both same-button double-presses and cross-button
// presses (e.g. Done after Reschedule already acked the same delivery).
import { randomUUID } from "node:crypto";
import { SNOOZE_MINUTES } from "./channels/telegram";
import type { DeliveryStatus } from "./state";
import type { ActorSurface, ReminderActionStore } from "./actionsStore";

export type { ActorSurface } from "./actionsStore";

const ACTIONABLE_STATUS = "sent";

export interface NotFoundOutcome {
  ok: false;
  reason: "not_found";
}

export interface ActionOutcome {
  ok: true;
  alreadyActed: boolean;
  // The delivery's current status: 'acked'/'snoozed' on a fresh action, or
  // whatever it already was (normally 'acked'/'snoozed' from an earlier
  // press, but any DeliveryStatus is possible on a stale/replayed request)
  // when alreadyActed is true.
  status: DeliveryStatus;
  taskId: string;
  taskTitle: string;
}

export interface SnoozeOutcome extends ActionOutcome {
  /** Epoch ms this delivery is snoozed until — only set on a fresh (not
   * alreadyActed) snooze; a replay doesn't re-derive the original value. */
  snoozedUntil: number | null;
}

export interface ActionParams {
  deliveryId: string;
  userId: string;
  actorSurface: ActorSurface;
  now: number;
}

export async function handleDone(
  store: ReminderActionStore,
  params: ActionParams,
): Promise<ActionOutcome | NotFoundOutcome> {
  const delivery = await store.findForAction(params.deliveryId, params.userId);
  if (!delivery) return { ok: false, reason: "not_found" };
  if (delivery.status !== ACTIONABLE_STATUS) {
    return alreadyActedOutcome(delivery.status, delivery.taskId, delivery.taskTitle);
  }
  await store.ackDelivery(params.deliveryId, params.actorSurface, params.now);
  await store.deactivateRule(delivery.ruleId, params.now);
  return {
    ok: true,
    alreadyActed: false,
    status: "acked",
    taskId: delivery.taskId,
    taskTitle: delivery.taskTitle,
  };
}

export async function handleSnooze(
  store: ReminderActionStore,
  params: ActionParams & { minutes?: number },
): Promise<SnoozeOutcome | NotFoundOutcome> {
  const delivery = await store.findForAction(params.deliveryId, params.userId);
  if (!delivery) return { ok: false, reason: "not_found" };
  if (delivery.status !== ACTIONABLE_STATUS) {
    return {
      ...alreadyActedOutcome(delivery.status, delivery.taskId, delivery.taskTitle),
      snoozedUntil: null,
    };
  }
  const minutes = params.minutes ?? SNOOZE_MINUTES;
  const snoozedUntil = params.now + minutes * 60_000;
  await store.snoozeDelivery(params.deliveryId, params.actorSurface, params.now);
  await store.createFollowupDelivery({
    id: randomUUID(),
    ruleId: delivery.ruleId,
    userId: params.userId,
    taskId: delivery.taskId,
    scheduledFor: snoozedUntil,
    channel: delivery.channel,
    createdAt: params.now,
  });
  return {
    ok: true,
    alreadyActed: false,
    status: "snoozed",
    taskId: delivery.taskId,
    taskTitle: delivery.taskTitle,
    snoozedUntil,
  };
}

export async function handleReschedule(
  store: ReminderActionStore,
  params: ActionParams,
): Promise<ActionOutcome | NotFoundOutcome> {
  const delivery = await store.findForAction(params.deliveryId, params.userId);
  if (!delivery) return { ok: false, reason: "not_found" };
  if (delivery.status !== ACTIONABLE_STATUS) {
    return alreadyActedOutcome(delivery.status, delivery.taskId, delivery.taskTitle);
  }
  await store.ackDelivery(params.deliveryId, params.actorSurface, params.now);
  return {
    ok: true,
    alreadyActed: false,
    status: "acked",
    taskId: delivery.taskId,
    taskTitle: delivery.taskTitle,
  };
}

// Telegram-only: the reschedule follow-up message's date chips. Custom
// isn't a kind here — it never touches the task, it just tells the user
// to open the app (see telegramActions.ts) — out of scope per the bead's
// "no date-picker inside Telegram" note.
export type RescheduleChipKind = "today_evening" | "tomorrow" | "in_2_days";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENING_HOUR_UTC = 18;
const MORNING_HOUR_UTC = 9;

// No per-user timezone field exists yet — same limitation and same UTC
// default as telegram/handlers/commands/today.ts's DEFAULT_TIMEZONE. If a
// chip is pressed after 18:00 UTC "today evening" lands in the past; that's
// an acceptable rough edge for v1 (a real per-user zone is a follow-up
// bead), not something worth guarding against here.
export function computeChipDueAt(kind: RescheduleChipKind, now: number): number {
  const d = new Date(now);
  if (kind === "today_evening") {
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), EVENING_HOUR_UTC);
  }
  const daysAhead = kind === "tomorrow" ? 1 : 2;
  const target = new Date(now + daysAhead * DAY_MS);
  return Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
    MORNING_HOUR_UTC,
  );
}

export async function handleRescheduleChip(
  store: ReminderActionStore,
  params: { taskId: string; userId: string; kind: RescheduleChipKind; now: number },
): Promise<{ ok: boolean; dueAt: number }> {
  const dueAt = computeChipDueAt(params.kind, params.now);
  const result = await store.rescheduleTaskDueDate(params.taskId, params.userId, dueAt, params.now);
  return { ok: result.ok, dueAt };
}

function alreadyActedOutcome(
  status: DeliveryStatus,
  taskId: string,
  taskTitle: string,
): ActionOutcome {
  return { ok: true, alreadyActed: true, status, taskId, taskTitle };
}
