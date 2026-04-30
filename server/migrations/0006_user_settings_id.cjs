/* BUG-AUDIT-1: Add synthetic `id` column to user_settings so the table
 * aligns with the sync protocol's SyncMetaSchema (which requires id: uuid).
 *
 * Strategy:
 *   1. Add nullable `id uuid` column.
 *   2. Backfill any existing rows (gen_random_uuid() per row).
 *   3. Set NOT NULL + DEFAULT gen_random_uuid().
 *   4. Drop the old user_id PRIMARY KEY constraint.
 *   5. Make `id` the new PRIMARY KEY.
 *   6. Add UNIQUE(user_id) to preserve the one-row-per-user invariant.
 */

exports.up = (pgm) => {
  // Step 1: add the column as nullable first so the backfill can run.
  pgm.addColumn("user_settings", {
    id: { type: "uuid" },
  });

  // Step 2: backfill existing rows.
  pgm.sql("UPDATE user_settings SET id = gen_random_uuid() WHERE id IS NULL");

  // Step 3: set NOT NULL and DEFAULT for future inserts.
  pgm.alterColumn("user_settings", "id", {
    notNull: true,
    default: pgm.func("gen_random_uuid()"),
  });

  // Step 4 & 5: swap the primary key.
  pgm.dropConstraint("user_settings", "user_settings_pkey");
  pgm.addConstraint("user_settings", "user_settings_pkey", "PRIMARY KEY (id)");

  // Step 6: unique constraint so user_id stays a natural key.
  pgm.addConstraint("user_settings", "user_settings_user_id_key", "UNIQUE (user_id)");
};

exports.down = (pgm) => {
  pgm.dropConstraint("user_settings", "user_settings_user_id_key");
  pgm.dropConstraint("user_settings", "user_settings_pkey");
  pgm.addConstraint("user_settings", "user_settings_pkey", "PRIMARY KEY (user_id)");
  pgm.dropColumn("user_settings", "id");
};
