-- CL-13: daily reflections (Daily Shutdown one-line journal).
--
-- Synced table — participates in the same push/pull protocol as tasks
-- and inbox_items, so a reflection saved on one device shows up on
-- another. Server mirror lives in server/migrations/0006.
--
-- Identity: id is a UUID primary key (so the standard sync ON
-- CONFLICT (id) path works), but the application-level invariant is
-- one reflection per (user_id, date). The store enforces that with a
-- read-then-upsert against UNIQUE (user_id, date): saveReflection
-- looks up an existing row for today and reuses its id, otherwise
-- mints a new one.
--
-- The date column is a TEXT 'YYYY-MM-DD' in the user's local tz at
-- shutdown time. We do not store a tz: the renderer computes "today"
-- from the local clock and the store accepts whatever string it
-- passes. Across-tz drift is acceptable for a one-line-per-day
-- journal.

CREATE TABLE daily_reflections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  UNIQUE (user_id, date)
) STRICT;

-- Review screen reads "this user's reflection for today" — the unique
-- index above already serves that lookup. An additional index on
-- user_id alone would be redundant.
