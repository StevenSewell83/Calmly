// TGR-10 — desktop-channel pending/ack data access. server/src/sync/ is
// pull-based (see sync/routes.ts's /sync/pull) — there is no live push
// stream to a connected desktop client — so the documented pragmatic
// variant from the bead's "Reality check" applies: deliveries for
// channel='desktop' are exposed via a pull endpoint the desktop sync loop
// polls on its own cadence, acking via POST (see desktopDeliveryRoutes.ts).
//
// Staleness (30 min) is computed in JS via partitionByStaleness rather than
// baked into the SQL WHERE clause, so the fresh/stale split is unit-testable
// without Postgres — same split as state.ts's pure math vs scheduler.ts's
// impure queries.
import type pg from "pg";
import type { ReminderImportance } from "@calmly/shared";
import { DESKTOP_CHANNEL_NAME } from "./channels/types";

export const DESKTOP_STALENESS_MS = 30 * 60_000;

export interface DesktopDeliveryCandidate {
  id: string;
  taskId: string;
  taskTitle: string | null;
  importance: ReminderImportance | null;
  scheduledFor: number;
  firedAt: number | null;
}

export interface PendingDesktopDelivery {
  id: string;
  taskId: string;
  taskTitle: string;
  importance: ReminderImportance;
  scheduledFor: number;
}

export interface StalenessSplit {
  fresh: PendingDesktopDelivery[];
  staleIds: string[];
}

// Falls back to 'soft'/'Reminder' the same way TelegramChannel.loadContent
// does when the rule/task row is gone by the time this is read — favors
// under- over over-formatting rather than dropping the notification.
// A delivery with no fired_at yet is treated as fresh (nothing to measure
// age against); attemptDispatch always sets fired_at before recordAttempt
// runs, so this only guards against a state the scheduler shouldn't produce.
export function partitionByStaleness(
  rows: readonly DesktopDeliveryCandidate[],
  now: number,
): StalenessSplit {
  const fresh: PendingDesktopDelivery[] = [];
  const staleIds: string[] = [];
  for (const row of rows) {
    const age = row.firedAt === null ? 0 : now - row.firedAt;
    if (age > DESKTOP_STALENESS_MS) {
      staleIds.push(row.id);
      continue;
    }
    fresh.push({
      id: row.id,
      taskId: row.taskId,
      taskTitle: row.taskTitle ?? "Reminder",
      importance: row.importance ?? "soft",
      scheduledFor: row.scheduledFor,
    });
  }
  return { fresh, staleIds };
}

export interface AckResult {
  ok: boolean;
}

export interface DesktopDeliveryStore {
  listPending(userId: string, now: number): Promise<PendingDesktopDelivery[]>;
  ack(deliveryId: string, userId: string, now: number): Promise<AckResult>;
}

interface CandidateRow {
  id: string;
  task_id: string;
  task_title: string | null;
  importance: ReminderImportance | null;
  scheduled_for: string;
  fired_at: string | null;
}

export function pgDesktopDeliveryStore(pool: pg.Pool): DesktopDeliveryStore {
  return {
    async listPending(userId, now) {
      const r = await pool.query<CandidateRow>(
        `SELECT rd.id, rd.task_id, t.title AS task_title, rr.importance,
                rd.scheduled_for::text AS scheduled_for, rd.fired_at::text AS fired_at
           FROM reminder_deliveries rd
           LEFT JOIN tasks t ON t.id = rd.task_id
           LEFT JOIN reminder_rules rr ON rr.id = rd.rule_id
          WHERE rd.user_id = $1 AND rd.channel = $2
            AND rd.status = 'sent' AND rd.desktop_acked_at IS NULL`,
        [userId, DESKTOP_CHANNEL_NAME],
      );
      const candidates: DesktopDeliveryCandidate[] = r.rows.map((row) => ({
        id: row.id,
        taskId: row.task_id,
        taskTitle: row.task_title,
        importance: row.importance,
        scheduledFor: parseInt(row.scheduled_for, 10),
        firedAt: row.fired_at !== null ? parseInt(row.fired_at, 10) : null,
      }));
      const { fresh, staleIds } = partitionByStaleness(candidates, now);
      if (staleIds.length > 0) {
        await pool.query(
          `UPDATE reminder_deliveries SET status = 'skipped' WHERE id = ANY($1::uuid[])`,
          [staleIds],
        );
      }
      return fresh;
    },

    async ack(deliveryId, userId, now) {
      const r = await pool.query(
        `UPDATE reminder_deliveries
            SET desktop_acked_at = $3
          WHERE id = $1 AND user_id = $2 AND channel = $4`,
        [deliveryId, userId, now, DESKTOP_CHANNEL_NAME],
      );
      return { ok: (r.rowCount ?? 0) > 0 };
    },
  };
}
