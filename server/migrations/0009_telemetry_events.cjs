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
 */

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable("telemetry_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
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
  });

  pgm.createIndex("telemetry_events", "received_at");
  pgm.createIndex("telemetry_events", "event_name");
  pgm.createIndex("telemetry_events", "anonymous_id");
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable("telemetry_events");
};
