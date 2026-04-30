/* MIGRATION_NUMBER_description — brief description (one line).
 *
 * Context:
 *   Why this change is needed. Reference the bead/issue ID.
 *
 * Rollback:
 *   Is exports.down safe in production? (yes/no and why)
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  // TODO: implement forward migration
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // TODO: implement rollback (or document why it is a no-op / destructive)
};
