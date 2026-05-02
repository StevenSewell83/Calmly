-- POL-01: Local telemetry outbox.
--
-- Events are buffered here and flushed to the server in batches. Rows are
-- deleted after a successful flush. The table is deliberately small —
-- only allow-listed event names and safe prop values are written.
-- If telemetry is disabled the outbox is purged immediately.

CREATE TABLE IF NOT EXISTS telemetry_outbox (
  id            TEXT    PRIMARY KEY,
  event_name    TEXT    NOT NULL,
  anonymous_id  TEXT    NOT NULL,
  session_id    TEXT    NOT NULL,
  props_json    TEXT    NOT NULL DEFAULT '{}',
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_telemetry_outbox_created_at
  ON telemetry_outbox (created_at);
