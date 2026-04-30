-- BUG-AUDIT-1 (calmly-3py.1): give user_settings a synthetic id PK so
-- it round-trips through the sync apply path like every other table.
--
-- The server's apply.ts validates every upsert payload against
-- SyncMetaSchema (which requires id: uuid) and runs ON CONFLICT (id)
-- against the destination row. user_settings was the lone exception:
-- PK was user_id, no id column at all. Push of any settings upsert
-- failed validation; pull-side had a special case that papered over
-- the read but not the write.
--
-- Mirror server migration 0007 — id TEXT PK + UNIQUE(user_id).
--
-- SQLite can't change PRIMARY KEY in place, so this is a standard
-- table-rebuild (CREATE NEW + INSERT-SELECT + DROP + RENAME). The
-- INSERT-SELECT mints a v4 UUID per row using lower(hex(randomblob))
-- so any pre-existing settings row keeps its data and gains a stable
-- id. Foreign keys are off during migrations (the runner wraps each
-- migration in BEGIN; PRAGMA legacy_alter_table=ON is the documented
-- escape hatch but not needed here because no other table references
-- user_settings).

CREATE TABLE user_settings_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
) STRICT;

INSERT INTO user_settings_new
  (id, user_id, settings_json, updated_at, version, deleted_at)
SELECT
  lower(
    hex(randomblob(4)) || '-' ||
    hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', 1 + (abs(random()) % 4), 1) ||
    substr(hex(randomblob(2)), 2) || '-' ||
    hex(randomblob(6))
  ),
  user_id,
  settings_json,
  updated_at,
  version,
  deleted_at
FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;
