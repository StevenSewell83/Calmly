/* F-08 magic-link auth schema.
 *
 * Conventions:
 *   - users.id is a UUID generated client-side (gen_random_uuid()) so the value
 *     is stable across replicas and matches the desktop's UUID convention.
 *   - magic_link_tokens.token_hash IS the primary key — we never persist the
 *     raw token, so a row IS its hash. Same idea for sessions.id_hash.
 *   - All time columns are TIMESTAMPTZ; the app passes ISO strings or Date.
 */

exports.up = (pgm) => {
  pgm.sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  pgm.createTable("users", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    email: { type: "text", notNull: true, unique: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  pgm.createTable("magic_link_tokens", {
    token_hash: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    expires_at: { type: "timestamptz", notNull: true },
    consumed_at: { type: "timestamptz" },
    requested_ip: { type: "text" },
    requested_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.createIndex("magic_link_tokens", ["user_id", "requested_at"]);
  pgm.createIndex("magic_link_tokens", ["requested_ip", "requested_at"]);

  pgm.createTable("sessions", {
    id_hash: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    expires_at: { type: "timestamptz", notNull: true },
    last_used_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    user_agent: { type: "text" },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.createIndex("sessions", "user_id");
};

exports.down = (pgm) => {
  pgm.dropTable("sessions");
  pgm.dropTable("magic_link_tokens");
  pgm.dropTable("users");
};
