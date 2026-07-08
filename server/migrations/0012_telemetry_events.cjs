/* POL-01: Server-side telemetry event store.
 *
 * Context:
 *   Desktop clients batch-flush allow-listed events to POST /telemetry/ingest.
 *   The server validates each event against the shared schema, strips any
 *   non-allow-listed props, and appends rows here. No user content, no
 *   free text — only event names, boolean/integer/short-string props, and
 *   anonymous identifiers.
 *
 * Rollback:
 *   Safe — the table is append-only analytics; dropping it loses data but
 *   does not affect application correctness.
 *
 * Renamed from 0009_telemetry_events (duplicate prefix with
 * 0009_calendar_event_imports_account_id). node-pg-migrate records applied
 * migrations by filename, so an environment that already ran it under the
 * 0009 name will run this file again — every statement is ifNotExists to
 * make that a no-op. The stale 0009_telemetry_events row in pgmigrations
 * is harmless.
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable(
    "telemetry_events",
    {
      id: {
        type: "uuid",
        primaryKey: true,
        default: pgm.func("gen_random_uuid()"),
      },
      event_name: { type: "text", notNull: true },
      anonymous_id: { type: "uuid", notNull: true },
      session_id: { type: "uuid", notNull: true },
      props_json: { type: "jsonb", notNull: true, default: "{}" },
      app_version: { type: "text" },
      received_at: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
    { ifNotExists: true },
  );

  pgm.createIndex("telemetry_events", "received_at", { ifNotExists: true });
  pgm.createIndex("telemetry_events", "event_name", { ifNotExists: true });
  pgm.createIndex("telemetry_events", "anonymous_id", { ifNotExists: true });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("telemetry_events");
};
