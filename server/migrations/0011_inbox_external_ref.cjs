/* TG-03a: inbox_items.external_ref + 'manual-split' source CHECK fix.
 *
 * Adds a nullable external_ref column so server-side ingestion paths
 * (Telegram bot in TG-03b, future calendar / email ingestion) can
 * dedupe and trace back to the source. Desktop-originated inbox items
 * leave it null. A partial UNIQUE index ensures bot retries with the
 * same Telegram message_id can't double-write — null external_refs
 * are excluded so the desktop path doesn't false-collide on NULL.
 *
 * Also restores parity on inbox_items_source_check, which was missing
 * 'manual-split' since calmly-u0u.13 (CL-05) added that source value
 * to the desktop schema and shared InboxSourceSchema enum but never
 * landed on the server side. A future inbox-items push from desktop
 * with source='manual-split' would have been rejected by the CHECK.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.addColumn("inbox_items", {
    external_ref: { type: "text", notNull: false },
  });
  pgm.createIndex("inbox_items", ["user_id", "external_ref"], {
    unique: true,
    name: "inbox_items_user_external_ref_unique",
    where: "external_ref IS NOT NULL",
  });
  pgm.dropConstraint("inbox_items", "inbox_items_source_check", {
    ifExists: true,
  });
  pgm.addConstraint(
    "inbox_items",
    "inbox_items_source_check",
    "CHECK (source IN ('desktop','telegram-text','telegram-voice','ai-split','manual-split'))",
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // Backfill any 'manual-split' rows back to 'desktop' so the tighter
  // CHECK can be reinstated without violating existing data.
  pgm.sql(
    "UPDATE inbox_items SET source = 'desktop' WHERE source = 'manual-split'",
  );
  pgm.dropConstraint("inbox_items", "inbox_items_source_check", {
    ifExists: true,
  });
  pgm.addConstraint(
    "inbox_items",
    "inbox_items_source_check",
    "CHECK (source IN ('desktop','telegram-text','telegram-voice','ai-split'))",
  );
  pgm.dropIndex("inbox_items", ["user_id", "external_ref"], {
    name: "inbox_items_user_external_ref_unique",
  });
  pgm.dropColumn("inbox_items", "external_ref");
};
