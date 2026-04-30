-- CL-05: extend tasks.source CHECK to include 'manual-split' for breakdown.
--
-- SQLite does not support ALTER TABLE ... DROP CONSTRAINT, so we recreate
-- the tasks table with the updated CHECK constraint using the standard
-- SQLite table-rebuild pattern (disable FKs, create new, copy, drop old, rename).

PRAGMA foreign_keys = OFF;

CREATE TABLE tasks_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','done','dropped','snoozed')),
  due_at INTEGER,
  parent_task_id TEXT,
  source TEXT NOT NULL
    CHECK (source IN ('desktop','telegram-text','telegram-voice','ai-split','manual-split')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  scheduled_start INTEGER,
  scheduled_end INTEGER
);

INSERT INTO tasks_new SELECT * FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- Recreate indexes that existed on the original table.
CREATE INDEX IF NOT EXISTS tasks_user_version ON tasks (user_id, version);
CREATE INDEX IF NOT EXISTS tasks_user_status  ON tasks (user_id, status);
CREATE INDEX IF NOT EXISTS tasks_scheduled_idx ON tasks (user_id, scheduled_start)
  WHERE scheduled_start IS NOT NULL;

PRAGMA foreign_keys = ON;
