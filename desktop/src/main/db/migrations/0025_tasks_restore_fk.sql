-- BUG calmly-ror: 0013_source_manual_split.sql rebuilt `tasks` (to widen the
-- `source` CHECK) using CREATE TABLE tasks_new (...) with plain column defs,
-- copy-then-rename. That rebuild dropped the two FK constraints the original
-- 0003_core_model.sql table had (user_id -> users(id) ON DELETE CASCADE,
-- parent_task_id -> tasks(id) ON DELETE CASCADE) and dropped STRICT. Deleting
-- a user silently orphaned their tasks instead of cascading, since the FK
-- was simply gone (SQLite never enforced one that isn't declared).
--
-- Migrations are append-only, so we rebuild `tasks` again here with the FKs
-- and STRICT restored, using the same standard rebuild pattern as the other
-- table-rebuild migrations in this directory (0013, 0022, 0023).

PRAGMA foreign_keys = OFF;

CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','done','dropped','snoozed')),
  due_at INTEGER,
  parent_task_id TEXT REFERENCES tasks_new(id) ON DELETE CASCADE,
  source TEXT NOT NULL
    CHECK (source IN ('desktop','telegram-text','telegram-voice','ai-split','manual-split')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  scheduled_start INTEGER,
  scheduled_end INTEGER
) STRICT;

INSERT INTO tasks_new SELECT * FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- Recreate indexes that existed on the pre-rebuild table.
CREATE INDEX IF NOT EXISTS tasks_user_version ON tasks (user_id, version);
CREATE INDEX IF NOT EXISTS tasks_user_status  ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS tasks_scheduled_idx ON tasks (user_id, scheduled_start)
  WHERE scheduled_start IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_due_at_idx ON tasks(user_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_parent_idx ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

PRAGMA foreign_keys = ON;
