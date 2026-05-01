-- CAL-04: local cache of calendar events imported from external providers.
--
-- This table is sync-replicated (server is source of truth for the import
-- record; the desktop import worker writes rows here which are then synced
-- up). De-duplication key: (user_id, provider, external_id).
--
-- raw_json holds the full provider event payload (Google Event object or
-- Microsoft Event resource) so the renderer can display all fields without
-- round-trips. start_at / end_at are normalized UTC epoch-ms for fast range
-- queries in Plan view. last_seen_at is the last import timestamp; rows not
-- seen in a sliding window are soft-deleted.

CREATE TABLE IF NOT EXISTS calendar_event_imports (
  id            TEXT    PRIMARY KEY,
  user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      TEXT    NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id   TEXT    NOT NULL,
  raw_json      TEXT    NOT NULL,
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_at    INTEGER
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS calendar_event_imports_unique_external
  ON calendar_event_imports (user_id, provider, external_id);

CREATE INDEX IF NOT EXISTS calendar_event_imports_start_idx
  ON calendar_event_imports (user_id, start_at)
  WHERE deleted_at IS NULL;
