// TGR-11 — data access for Done/Snooze/Reschedule. Reads the delivery+task
// row an action needs to render (title, current status) and performs the
// acked/snoozed transitions plus the audit stamp added by
// 0015_reminder_deliveries_actions.cjs. Kept behind an interface, same
// split as store.ts's ReminderStore, so actions.test.ts exercises the
// state-transition rules against a fake instead of Postgres (no Docker in
// this container — see agent-common.md).
import type pg from "pg";
import { DESKTOP_CHANNEL_NAME, TELEGRAM_CHANNEL_NAME } from "./channels/types";
import type { DeliveryStatus } from "./state";
import type { CreateDeliveryInput, ReminderStore } from "./store";

// Which surface performed the action — reuses the channel-name constants
// (same category as Source enum values, see channels/types.ts's PREVENT-2
// note) rather than a fresh string union, since "desktop" and "telegram"
// are otherwise banned string literals outside shared/.
export type ActorSurface = typeof TELEGRAM_CHANNEL_NAME | typeof DESKTOP_CHANNEL_NAME;

export interface ActionDelivery {
  id: string;
  ruleId: string;
  userId: string;
  taskId: string;
  channel: string;
  status: DeliveryStatus;
  taskTitle: string;
}

export interface RescheduleTaskResult {
  ok: boolean;
}

export interface ReminderActionStore {
  findForAction(deliveryId: string, userId: string): Promise<ActionDelivery | null>;
  ackDelivery(deliveryId: string, actorSurface: ActorSurface, now: number): Promise<void>;
  snoozeDelivery(deliveryId: string, actorSurface: ActorSurface, now: number): Promise<void>;
  deactivateRule(ruleId: string, now: number): Promise<void>;
  /** Same slot semantics as store.ts's createDelivery (ON CONFLICT DO
   * NOTHING on (rule_id, scheduled_for)) — reused via the ReminderStore
   * passed to pgReminderActionStore rather than duplicated here. */
  createFollowupDelivery(input: CreateDeliveryInput): Promise<{ created: boolean }>;
  rescheduleTaskDueDate(
    taskId: string,
    userId: string,
    dueAt: number,
    now: number,
  ): Promise<RescheduleTaskResult>;
}

interface ActionDeliveryRow {
  id: string;
  rule_id: string;
  user_id: string;
  task_id: string;
  channel: string;
  status: DeliveryStatus;
  task_title: string | null;
}

// Same fallback as TelegramChannel.loadContent / desktopDeliveries.ts's
// partitionByStaleness — favors under- over over-formatting if the task
// row is gone by the time an action is taken.
const FALLBACK_TASK_TITLE = "Reminder";

export function pgReminderActionStore(
  pool: pg.Pool,
  reminderStore: ReminderStore,
): ReminderActionStore {
  return {
    async findForAction(deliveryId, userId) {
      const r = await pool.query<ActionDeliveryRow>(
        `SELECT rd.id, rd.rule_id, rd.user_id, rd.task_id, rd.channel, rd.status,
                t.title AS task_title
           FROM reminder_deliveries rd
           LEFT JOIN tasks t ON t.id = rd.task_id
          WHERE rd.id = $1 AND rd.user_id = $2`,
        [deliveryId, userId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        id: row.id,
        ruleId: row.rule_id,
        userId: row.user_id,
        taskId: row.task_id,
        channel: row.channel,
        status: row.status,
        taskTitle: row.task_title ?? FALLBACK_TASK_TITLE,
      };
    },

    // Conditional on status='sent' so a concurrent double-press (Telegram +
    // desktop racing past the same findForAction read) resolves atomically:
    // exactly one caller transitions the row, the other sees false and
    // reports alreadyActed instead of re-applying side effects.
    async ackDelivery(deliveryId, actorSurface, now) {
      const res = await pool.query(
        `UPDATE reminder_deliveries SET status = 'acked', acted_at = $2, acted_via = $3
         WHERE id = $1 AND status = 'sent' RETURNING id`,
        [deliveryId, now, actorSurface],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async snoozeDelivery(deliveryId, actorSurface, now) {
      const res = await pool.query(
        `UPDATE reminder_deliveries SET status = 'snoozed', acted_at = $2, acted_via = $3
         WHERE id = $1 AND status = 'sent' RETURNING id`,
        [deliveryId, now, actorSurface],
      );
      return (res.rowCount ?? 0) > 0;
    },

    async deactivateRule(ruleId, now) {
      await pool.query(
        `UPDATE reminder_rules SET active = 0, updated_at = $2, version = nextval('sync_version') WHERE id = $1`,
        [ruleId, now],
      );
    },

    createFollowupDelivery(input) {
      return reminderStore.createDelivery(input);
    },

    async rescheduleTaskDueDate(taskId, userId, dueAt, now) {
      const r = await pool.query(
        `UPDATE tasks SET due_at = $3, updated_at = $4, version = nextval('sync_version')
          WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [taskId, userId, dueAt, now],
      );
      return { ok: (r.rowCount ?? 0) > 0 };
    },
  };
}
