-- CL-13 Review / Daily Shutdown.
--
-- daily_reflections is a sync table (has version/updated_at/deleted_at) so
-- reflections written on desktop can appear on other devices. UNIQUE(user_id, date)
-- enforces one reflection per calendar day per user; the review IPC upserts on
-- conflict so repeated complete-shutdown calls are idempotent.

CREATE TABLE IF NOT EXISTS daily_reflections (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,         -- 'YYYY-MM-DD' local date
  text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  UNIQUE(user_id, date)
) STRICT;

CREATE INDEX IF NOT EXISTS daily_reflections_user_date_idx
  ON daily_reflections(user_id, date);
