/* CAL-01: server-side state for the Google / Microsoft Calendar OAuth flow.
 *
 * Three tables:
 *   - calendar_accounts: durable record of which external accounts a user
 *     has connected. Holds NO secrets. (refresh tokens live client-side in
 *     the F-12 secret store.)
 *   - oauth_states: short-lived state + PKCE verifier rows used to bind
 *     /oauth/<provider>/start to the matching /callback. Rotated on use.
 *   - oauth_tickets: one-shot pickup table. After a successful callback,
 *     the server briefly holds the refresh_token / access_token here so
 *     the desktop client can redeem them via POST /oauth/<provider>/redeem.
 *     Rows are deleted on redeem and expire after a few minutes.
 *
 * Rollback:
 *   exports.down is safe — drops the three tables. No data outlives an
 *   in-flight OAuth handshake, so dropping in production is acceptable
 *   provided users re-authorize afterwards.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.sql("CREATE EXTENSION IF NOT EXISTS pgcrypto;");

  pgm.createTable("calendar_accounts", {
    id: {
      type: "uuid",
      primaryKey: true,
      default: pgm.func("gen_random_uuid()"),
    },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    provider: {
      type: "text",
      notNull: true,
      check: "provider IN ('google', 'microsoft')",
    },
    external_account_id: { type: "text", notNull: true },
    email: { type: "text", notNull: true },
    status: {
      type: "text",
      notNull: true,
      default: "connected",
      check: "status IN ('connected', 'disconnected', 'error')",
    },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
    updated_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.addConstraint(
    "calendar_accounts",
    "calendar_accounts_user_provider_external_key",
    "UNIQUE (user_id, provider, external_account_id)",
  );
  pgm.createIndex("calendar_accounts", ["user_id", "provider"]);

  pgm.createTable("oauth_states", {
    state: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    provider: {
      type: "text",
      notNull: true,
      check: "provider IN ('google', 'microsoft')",
    },
    code_verifier: { type: "text", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.createIndex("oauth_states", "expires_at");

  pgm.createTable("oauth_tickets", {
    jti: { type: "text", primaryKey: true },
    user_id: {
      type: "uuid",
      notNull: true,
      references: "users(id)",
      onDelete: "CASCADE",
    },
    account_id: {
      type: "uuid",
      notNull: true,
      references: "calendar_accounts(id)",
      onDelete: "CASCADE",
    },
    provider: {
      type: "text",
      notNull: true,
      check: "provider IN ('google', 'microsoft')",
    },
    refresh_token: { type: "text", notNull: true },
    access_token: { type: "text", notNull: true },
    expires_in: { type: "integer", notNull: true },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });
  pgm.createIndex("oauth_tickets", "expires_at");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("oauth_tickets");
  pgm.dropTable("oauth_states");
  pgm.dropTable("calendar_accounts");
};
