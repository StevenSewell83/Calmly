/* 0014_reminder_deliveries_desktop_acked — desktop-ack tracking column.
 *
 * Context:
 *   TGR-10 (calmly-13d.10): the desktop notification fallback channel has
 *   no live push transport (server/src/sync/ is pull-based), so the
 *   desktop client discovers channel='desktop' deliveries by polling
 *   GET /reminder-deliveries/pending and acks each one it has displayed
 *   via POST /reminder-deliveries/:id/desktop-ack (see
 *   server/src/reminders/desktopDeliveries.ts). This column is that ack
 *   marker — separate from `status` (0013_reminder_deliveries) because
 *   "displayed on the desktop client" is orthogonal to the delivery's
 *   dispatch/user-action lifecycle (still 'sent' until TGR-11 acts on it).
 *   Next free number after 0013 — see TGR-08's migration for the same
 *   caution about this repo having picked up duplicate numeric prefixes
 *   before (0009 exists twice); 0014 was confirmed free at authoring time.
 *
 * Rollback:
 *   Safe — drops a nullable column with no other readers.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn("reminder_deliveries", {
    desktop_acked_at: { type: "bigint", notNull: false },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropColumn("reminder_deliveries", "desktop_acked_at");
};
