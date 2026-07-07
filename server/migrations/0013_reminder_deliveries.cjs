/* TGR-08: reminder_deliveries table.
 *
 * Context:
 *   Rebuilds lost RM-03 (calmly-91t.3) as calmly-13d.8. One row per
 *   attempted reminder firing for a reminder_rules row (synced from
 *   desktop — see reminder_rules in 0003_sync.cjs). Server-only state,
 *   like outbound_messages (0012): a delivery is a fact about what the
 *   server did, not something the desktop client edits, so no sync trio
 *   here either.
 *
 * Columns:
 *   id                   Row id (uuid), minted by the scheduler.
 *   rule_id              reminder_rules.id this delivery was fired for.
 *   user_id              Owning user (FK to users; cascades on delete).
 *   task_id              Denormalized from the rule at creation time so
 *                        cancel/list queries don't need to join
 *                        reminder_rules just to find the task.
 *   scheduled_for        Epoch ms this delivery's slot was due. Also the
 *                        dedupe key together with rule_id — see the
 *                        unique index below.
 *   fired_at             Epoch ms of the most recent dispatch *attempt*
 *                        (set whether that attempt succeeded or failed);
 *                        null until the first attempt. The scheduler
 *                        computes retry-due (1m/5m/15m backoff) from
 *                        this, not from scheduled_for, since a failed
 *                        attempt's next try is relative to when it was
 *                        last tried.
 *   channel              Channel name that produced the current status
 *                        ('telegram' | 'desktop' for now; see
 *                        server/src/reminders/channels).
 *   status               'pending' (created, not yet resolved or still
 *                        retrying), 'sent' (delivered), 'failed'
 *                        (retries exhausted), 'skipped' (cancelled or
 *                        rule/task stopped it), 'acked' (user
 *                        acknowledged — TGR-11), 'snoozed' (user snoozed
 *                        — TGR-11).
 *   attempt_count        Number of dispatch attempts made so far.
 *   last_error           Most recent failure message, if any. Never PII
 *                        (no task content) — just the channel error.
 *   outbound_message_id  outbound_messages.id when the channel used was
 *                        Telegram and it produced a row there. Null for
 *                        other channels or failed sends.
 *   created_at           Epoch ms the delivery row was written.
 *
 * The unique index on (rule_id, scheduled_for) is the scheduler's
 * idempotency guard: `INSERT ... ON CONFLICT DO NOTHING` lets two
 * overlapping ticks (this bead documents a single-process assumption,
 * but the guard is cheap insurance) race on creating the same slot
 * without duplicating it.
 *
 * Rollback:
 *   Safe — drops a server-only table with no cross-table readers yet.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable("reminder_deliveries", {
    id: { type: "uuid", primaryKey: true },
    rule_id: {
      type: "text",
      notNull: true,
      references: "reminder_rules(id)",
      onDelete: "CASCADE",
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    task_id: { type: "text", notNull: true },
    scheduled_for: { type: "bigint", notNull: true },
    fired_at: { type: "bigint", notNull: false },
    channel: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "pending" },
    attempt_count: { type: "integer", notNull: true, default: 0 },
    last_error: { type: "text", notNull: false },
    outbound_message_id: {
      type: "uuid",
      notNull: false,
      references: "outbound_messages(id)",
      onDelete: "SET NULL",
    },
    created_at: { type: "bigint", notNull: true },
  });
  pgm.addConstraint(
    "reminder_deliveries",
    "reminder_deliveries_status_check",
    "CHECK (status IN ('pending','sent','failed','skipped','acked','snoozed'))",
  );
  pgm.createIndex("reminder_deliveries", ["rule_id", "scheduled_for"], {
    unique: true,
    name: "reminder_deliveries_rule_slot_uniq",
  });
  pgm.createIndex("reminder_deliveries", ["status"]);
  pgm.createIndex("reminder_deliveries", ["user_id", "created_at"]);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("reminder_deliveries");
};
