-- BUG-AUDIT-1: Add synthetic `id` column to user_settings so the sync
-- protocol can use id as the primary key, matching every other sync table.
--
-- SQLite doesn't support DROP/ADD PRIMARY KEY directly, so we recreate the
-- table. Existing data is preserved via INSERT INTO … SELECT.

CREATE TABLE user_settings_new (
  id TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' ||
                            lower(hex(randomblob(2))) || '-4' ||
                            substr(lower(hex(randomblob(2))),2) || '-' ||
                            substr('89ab', abs(random()) % 4 + 1, 1) ||
                            substr(lower(hex(randomblob(2))),2) || '-' ||
                            lower(hex(randomblob(6)))) PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
) STRICT;

INSERT INTO user_settings_new (user_id, settings_json, updated_at, version, deleted_at)
  SELECT user_id, settings_json, updated_at, version, deleted_at FROM user_settings;

DROP TABLE user_settings;
ALTER TABLE user_settings_new RENAME TO user_settings;
