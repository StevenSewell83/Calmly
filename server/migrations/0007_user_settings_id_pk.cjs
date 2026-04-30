/* BUG-AUDIT-1 (calmly-3py.1): give user_settings a synthetic id PK
 * so apply.ts / pull.ts handle it like every other sync table.
 *
 * apply.ts validates every push payload with SyncMetaSchema (requires
 * id: uuid) and runs ON CONFLICT (id) against the destination row.
 * user_settings was the lone exception — PK was user_id, no id
 * column at all — so any push silently failed. This migration adds
 * id, backfills via gen_random_uuid(), swaps the primary key, and
 * adds UNIQUE(user_id) to preserve the one-row-per-user invariant.
 *
 * Mirrors desktop migration 0011_user_settings_id_pk.sql.
 */

exports.up = (pgm) => {
  // pgcrypto exposes gen_random_uuid; createExtension is idempotent.
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.addColumn("user_settings", { id: { type: "text" } });
  pgm.sql("UPDATE user_settings SET id = gen_random_uuid()::text");
  pgm.alterColumn("user_settings", "id", { notNull: true });

  // node-pg-migrate auto-names PKs as "<table>_pkey".
  pgm.dropConstraint("user_settings", "user_settings_pkey");
  pgm.addConstraint("user_settings", "user_settings_pkey", {
    primaryKey: "id",
  });

  pgm.addConstraint("user_settings", "user_settings_user_id_uniq", {
    unique: "user_id",
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint("user_settings", "user_settings_user_id_uniq");
  pgm.dropConstraint("user_settings", "user_settings_pkey");
  pgm.addConstraint("user_settings", "user_settings_pkey", {
    primaryKey: "user_id",
  });
  pgm.dropColumn("user_settings", "id");
};
