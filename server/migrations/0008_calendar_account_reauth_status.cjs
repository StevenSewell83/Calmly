/* CAL-03: extend calendar_accounts.status with 'reauth_required'.
 *
 * Context:
 *   When a desktop refresh attempt returns invalid_grant (user revoked the
 *   token or de-authorized the app), the desktop client marks the account
 *   reauth_required so the renderer can show a reconnect banner. The server
 *   doesn't currently use the new value but the CHECK has to allow it for
 *   sync replay symmetry.
 *
 * Rollback:
 *   Safe in production iff no rows currently use 'reauth_required'. Down
 *   first remaps any such rows back to 'error' before reinstating the
 *   tighter CHECK so the migration cannot fail mid-flight.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.dropConstraint("calendar_accounts", "calendar_accounts_status_check", {
    ifExists: true,
  });
  pgm.addConstraint(
    "calendar_accounts",
    "calendar_accounts_status_check",
    "CHECK (status IN ('connected', 'disconnected', 'error', 'reauth_required'))",
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.sql(
    "UPDATE calendar_accounts SET status = 'error' WHERE status = 'reauth_required'",
  );
  pgm.dropConstraint("calendar_accounts", "calendar_accounts_status_check", {
    ifExists: true,
  });
  pgm.addConstraint(
    "calendar_accounts",
    "calendar_accounts_status_check",
    "CHECK (status IN ('connected', 'disconnected', 'error'))",
  );
};
