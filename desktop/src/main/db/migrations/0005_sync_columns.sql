-- F-11b: extend F-05's domain tables with sync metadata + add op_queue / sync_state.
--
-- SQLite STRICT permits ALTER TABLE ADD COLUMN when the new column type is one
-- of the strict types and the column either allows NULL or has a literal
-- DEFAULT. version uses DEFAULT 0; deleted_at allows NULL — both qualify.

ALTER TABLE inbox_items            ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inbox_items            ADD COLUMN deleted_at INTEGER;

ALTER TABLE tasks                  ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks                  ADD COLUMN deleted_at INTEGER;

ALTER TABLE events                 ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE events                 ADD COLUMN deleted_at INTEGER;

ALTER TABLE reminder_rules         ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reminder_rules         ADD COLUMN deleted_at INTEGER;

ALTER TABLE recurrence_rules       ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recurrence_rules       ADD COLUMN deleted_at INTEGER;

ALTER TABLE calendar_event_imports ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calendar_event_imports ADD COLUMN deleted_at INTEGER;

ALTER TABLE ai_suggestions         ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_suggestions         ADD COLUMN deleted_at INTEGER;

ALTER TABLE telegram_links         ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE telegram_links         ADD COLUMN deleted_at INTEGER;

ALTER TABLE user_settings          ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings          ADD COLUMN deleted_at INTEGER;

CREATE TABLE op_queue (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert','delete')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS op_queue_created_idx ON op_queue(created_at);

CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_pulled_version INTEGER NOT NULL DEFAULT 0,
  last_pushed_at INTEGER
) STRICT;
INSERT OR IGNORE INTO sync_state (id, last_pulled_version) VALUES (1, 0);
