/* CAL-04a: extend calendar_event_imports with account_id so events from
 * multiple accounts under the same provider don't share an external_id
 * collision space. Pairs with desktop migration
 * 0018_calendar_event_imports_account_id.sql and shared/src/model/calendar.ts.
 *
 * Server side mirrors the desktop schema: account_id TEXT NOT NULL plus
 * an updated UNIQUE (user_id, account_id, external_id) constraint.
 * No FK to calendar_accounts because that table doesn't exist on the
 * server (it's a local-only mirror desktop-side); the server just
 * accepts whatever account_id the desktop sync push contains.
 *
 * Rollback drops the new column and restores the old UNIQUE.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropConstraint(
    "calendar_event_imports",
    "calendar_event_imports_unique_external",
    { ifExists: true },
  );
  pgm.addColumn("calendar_event_imports", {
    account_id: { type: "text", notNull: false },
  });
  // Backfill any existing dev rows so the NOT NULL flip doesn't fail.
  // CAL-04 has not shipped yet so this should be a no-op in production,
  // but local dev DBs might have F-05 round-trip seed data.
  pgm.sql(
    `UPDATE calendar_event_imports SET account_id = '' WHERE account_id IS NULL`,
  );
  pgm.alterColumn("calendar_event_imports", "account_id", { notNull: true });
  pgm.addConstraint(
    "calendar_event_imports",
    "calendar_event_imports_unique_external",
    { unique: ["user_id", "account_id", "external_id"] },
  );
  pgm.createIndex("calendar_event_imports", ["account_id", "start_at"]);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropIndex("calendar_event_imports", ["account_id", "start_at"]);
  pgm.dropConstraint(
    "calendar_event_imports",
    "calendar_event_imports_unique_external",
    { ifExists: true },
  );
  pgm.dropColumn("calendar_event_imports", "account_id");
  pgm.addConstraint(
    "calendar_event_imports",
    "calendar_event_imports_unique_external",
    { unique: ["user_id", "provider", "external_id"] },
  );
};
