/* CL-03: snooze support on inbox_items.
 *
 * Mirror of the desktop migration 0006 — snoozed_until is a unix-ms
 * BIGINT, nullable. The visibility predicate (resolved_at IS NULL AND
 * (snoozed_until IS NULL OR snoozed_until <= now)) is applied client-
 * side; the server just stores and replicates the column.
 */

exports.up = (pgm) => {
  pgm.addColumn("inbox_items", {
    snoozed_until: { type: "bigint" },
  });
  pgm.createIndex("inbox_items", ["user_id", "snoozed_until"], {
    name: "inbox_items_snoozed_idx",
    where: "snoozed_until IS NOT NULL",
  });
};

exports.down = (pgm) => {
  pgm.dropIndex("inbox_items", ["user_id", "snoozed_until"], {
    name: "inbox_items_snoozed_idx",
  });
  pgm.dropColumn("inbox_items", "snoozed_until");
};
