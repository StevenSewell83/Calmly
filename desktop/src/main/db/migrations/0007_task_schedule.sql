-- CL-06: time-block placement on tasks.
--
-- scheduled_start / scheduled_end are unix-ms timestamps. Both NULL
-- means the task is in the Plan backlog (unplaced); both non-NULL
-- means the task is rendered as a TimeBlock on the day grid. They are
-- always set or cleared as a pair — the IPC enforces this. We do not
-- add a CHECK constraint so the renderer can write either field
-- independently across two RTTs without violating the DB during the
-- transition (the IPC's transaction wraps the pair atomically anyway).
--
-- STRICT permits ALTER TABLE ADD COLUMN as long as the new column
-- allows NULL or has a literal DEFAULT; nullable INTEGER qualifies.

ALTER TABLE tasks ADD COLUMN scheduled_start INTEGER;
ALTER TABLE tasks ADD COLUMN scheduled_end INTEGER;

-- Plan view's primary read filters on (user_id, scheduled_start) for
-- 'placed today'. Partial index keeps it cheap and ignores backlog
-- rows entirely.
CREATE INDEX IF NOT EXISTS tasks_scheduled_idx
  ON tasks(user_id, scheduled_start)
  WHERE scheduled_start IS NOT NULL;
