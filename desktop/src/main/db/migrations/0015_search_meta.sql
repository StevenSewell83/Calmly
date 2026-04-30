-- SRCH-02: metadata table for FTS backfill status tracking.
--
-- Stores one row per FTS migration version. The backfill job checks this
-- table at boot to decide whether to skip or run the backfill.

CREATE TABLE IF NOT EXISTS _search_meta (
  version     INTEGER PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'running', 'done', 'error')),
  started_at  INTEGER,
  finished_at INTEGER,
  row_count   INTEGER
);

-- Seed the row for migration version 14 (0014_search_fts) so the
-- boot-time backfill knows to treat it as already done (the migration
-- itself ran the INSERT...SELECT backfill inline).
INSERT OR IGNORE INTO _search_meta (version, status, finished_at, row_count)
  VALUES (14, 'done', unixepoch() * 1000, 0);
