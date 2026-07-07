// TGR-08 — pg-backed data access for the scheduler. Kept behind the
// ReminderStore interface so scheduler.test.ts can inject an in-memory
// fake instead of standing up Postgres (this container has no Docker —
// see AGENTS.md / agent-common.md environment limits); the real
// pgReminderStore is exercised by the docker-gated integration test.
import type pg from "pg";
import type { DeliveryStatus } from "./state";

export interface DueRuleCandidate {
  ruleId: string;
  taskId: string;
  userId: string;
  intervalSeconds: number;
  ruleUpdatedAt: number;
  taskStatus: string;
  taskDeletedAt: number | null;
  lastDelivery: { scheduledFor: number; status: DeliveryStatus } | null;
}

export interface PendingRetryCandidate {
  id: string;
  ruleId: string;
  userId: string;
  taskId: string;
  scheduledFor: number;
  attemptCount: number;
  lastAttemptAt: number;
}

// TGR-11: a delivery row created by handleSnooze (actionsStore.ts) for a
// future scheduled_for, deliberately left un-dispatched at creation time
// (unlike processDueRules, which creates+dispatches synchronously in the
// same tick). This candidate set is how the scheduler later discovers and
// fires it — attempt_count=0 distinguishes it from a normal retry
// candidate (findPendingRetryCandidates requires attempt_count > 0), so
// the two queries never overlap.
export interface DueFollowupCandidate {
  id: string;
  ruleId: string;
  userId: string;
  taskId: string;
  scheduledFor: number;
}

export interface CreateDeliveryInput {
  id: string;
  ruleId: string;
  userId: string;
  taskId: string;
  scheduledFor: number;
  channel: string;
  createdAt: number;
}

export interface RecordAttemptInput {
  now: number;
  channel: string;
  ok: boolean;
  attemptCount: number;
  exhausted: boolean;
  error?: string | null;
  outboundMessageId?: string | null;
}

export type CancelResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "already_terminal" };

export interface ReminderStore {
  findActiveRuleCandidates(): Promise<DueRuleCandidate[]>;
  findPendingRetryCandidates(): Promise<PendingRetryCandidate[]>;
  /** TGR-11 — see DueFollowupCandidate's doc comment above. */
  findDueFollowupDeliveries(now: number): Promise<DueFollowupCandidate[]>;
  /** Insert via ON CONFLICT(rule_id, scheduled_for) DO NOTHING — `created:
   * false` means another tick already owns this slot. */
  createDelivery(input: CreateDeliveryInput): Promise<{ created: boolean }>;
  recordAttempt(deliveryId: string, input: RecordAttemptInput): Promise<void>;
  cancel(deliveryId: string, userId: string): Promise<CancelResult>;
}

interface DueRuleRow {
  rule_id: string;
  task_id: string;
  user_id: string;
  interval_seconds: number;
  rule_updated_at: string;
  task_status: string;
  task_deleted_at: string | null;
  last_scheduled_for: string | null;
  last_status: DeliveryStatus | null;
}

interface PendingRetryRow {
  id: string;
  rule_id: string;
  user_id: string;
  task_id: string;
  scheduled_for: string;
  attempt_count: number;
  fired_at: string | null;
}

export function pgReminderStore(pool: pg.Pool): ReminderStore {
  return {
    async findActiveRuleCandidates() {
      const r = await pool.query<DueRuleRow>(
        `SELECT rr.id AS rule_id, rr.task_id, rr.user_id, rr.interval_seconds,
                rr.updated_at::text AS rule_updated_at,
                t.status AS task_status, t.deleted_at::text AS task_deleted_at,
                ld.scheduled_for::text AS last_scheduled_for, ld.status AS last_status
           FROM reminder_rules rr
           JOIN tasks t ON t.id = rr.task_id
           LEFT JOIN LATERAL (
             SELECT scheduled_for, status FROM reminder_deliveries
              WHERE rule_id = rr.id
              ORDER BY scheduled_for DESC
              LIMIT 1
           ) ld ON true
          WHERE rr.active = 1 AND rr.deleted_at IS NULL`,
      );
      return r.rows.map((row) => ({
        ruleId: row.rule_id,
        taskId: row.task_id,
        userId: row.user_id,
        intervalSeconds: row.interval_seconds,
        ruleUpdatedAt: parseInt(row.rule_updated_at, 10),
        taskStatus: row.task_status,
        taskDeletedAt:
          row.task_deleted_at !== null ? parseInt(row.task_deleted_at, 10) : null,
        lastDelivery:
          row.last_scheduled_for !== null
            ? {
                scheduledFor: parseInt(row.last_scheduled_for, 10),
                status: row.last_status as DeliveryStatus,
              }
            : null,
      })) as DueRuleCandidate[];
    },

    async findPendingRetryCandidates() {
      const r = await pool.query<PendingRetryRow>(
        `SELECT id, rule_id, user_id, task_id, scheduled_for::text AS scheduled_for,
                attempt_count, fired_at::text AS fired_at
           FROM reminder_deliveries
          WHERE status = 'pending' AND attempt_count > 0`,
      );
      return r.rows.map((row) => ({
        id: row.id,
        ruleId: row.rule_id,
        userId: row.user_id,
        taskId: row.task_id,
        scheduledFor: parseInt(row.scheduled_for, 10),
        attemptCount: row.attempt_count,
        lastAttemptAt: row.fired_at !== null ? parseInt(row.fired_at, 10) : 0,
      }));
    },

    async findDueFollowupDeliveries(now) {
      const r = await pool.query<{
        id: string;
        rule_id: string;
        user_id: string;
        task_id: string;
        scheduled_for: string;
      }>(
        `SELECT id, rule_id, user_id, task_id, scheduled_for::text AS scheduled_for
           FROM reminder_deliveries
          WHERE status = 'pending' AND attempt_count = 0 AND scheduled_for <= $1`,
        [now],
      );
      return r.rows.map((row) => ({
        id: row.id,
        ruleId: row.rule_id,
        userId: row.user_id,
        taskId: row.task_id,
        scheduledFor: parseInt(row.scheduled_for, 10),
      }));
    },

    async createDelivery(input) {
      const r = await pool.query(
        `INSERT INTO reminder_deliveries
           (id, rule_id, user_id, task_id, scheduled_for, channel, status, attempt_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7)
         ON CONFLICT (rule_id, scheduled_for) DO NOTHING`,
        [
          input.id,
          input.ruleId,
          input.userId,
          input.taskId,
          input.scheduledFor,
          input.channel,
          input.createdAt,
        ],
      );
      return { created: (r.rowCount ?? 0) > 0 };
    },

    async recordAttempt(deliveryId, input) {
      const status: DeliveryStatus = input.ok
        ? "sent"
        : input.exhausted
          ? "failed"
          : "pending";
      await pool.query(
        `UPDATE reminder_deliveries
            SET status = $2, attempt_count = $3, fired_at = $4, channel = $5,
                last_error = $6, outbound_message_id = $7
          WHERE id = $1`,
        [
          deliveryId,
          status,
          input.attemptCount,
          input.now,
          input.channel,
          input.error ?? null,
          input.outboundMessageId ?? null,
        ],
      );
    },

    async cancel(deliveryId, userId) {
      const r = await pool.query(
        `UPDATE reminder_deliveries
            SET status = 'skipped'
          WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
        [deliveryId, userId],
      );
      if ((r.rowCount ?? 0) > 0) return { ok: true };
      const check = await pool.query(
        `SELECT 1 FROM reminder_deliveries WHERE id = $1 AND user_id = $2`,
        [deliveryId, userId],
      );
      return (check.rowCount ?? 0) > 0
        ? { ok: false, reason: "already_terminal" }
        : { ok: false, reason: "not_found" };
    },
  };
}
