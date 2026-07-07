/* 0015_reminder_deliveries_actions — audit stamp for Done/Snooze/Reschedule.
 *
 * Context:
 *   TGR-11 (calmly-13d.11): Done/Snooze/Reschedule act on a
 *   reminder_deliveries row from two surfaces (Telegram callback, desktop
 *   HTTP action endpoint). Per the bead's "Audit: record actor surface +
 *   timestamp on the delivery row" — these two columns are that record,
 *   set once by whichever surface's action handler first moves the row out
 *   of 'sent' (into 'acked' or 'snoozed'; see server/src/reminders/
 *   actionsStore.ts). Separate from `fired_at` (0013) — that's the
 *   scheduler's dispatch-attempt clock, this is the user's response clock.
 *
 * Rollback:
 *   Safe — drops two nullable columns with no other readers.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumns("reminder_deliveries", {
    acted_at: { type: "bigint", notNull: false },
    acted_via: { type: "text", notNull: false },
  });
  pgm.addConstraint(
    "reminder_deliveries",
    "reminder_deliveries_acted_via_check",
    "CHECK (acted_via IS NULL OR acted_via IN ('telegram','desktop'))",
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumns("reminder_deliveries", ["acted_at", "acted_via"]);
};
