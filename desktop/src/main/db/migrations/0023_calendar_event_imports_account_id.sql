-- CAL-04a: extend calendar_event_imports with account_id so events from
-- multiple accounts under the same provider don't share an external_id
-- collision space. Pairs with the matching server migration
-- 0009_calendar_event_imports_account_id.cjs and the shared model
-- update in shared/src/model/calendar.ts.
--
-- We rebuild the table (rename → create → copy → drop) because:
--   1. SQLite ALTER TABLE ADD COLUMN cannot add a NOT NULL TEXT column
--      without a literal DEFAULT, and the empty-string default would
--      silently mask a worker bug.
--   2. The pre-existing UNIQUE (user_id, provider, external_id)
--      becomes UNIQUE (user_id, account_id, external_id), which SQLite
--      cannot rewrite in place either.
--   3. The previous CAL migrations (0017) used the same rename pattern,
--      so the operational story matches.
--
-- account_id is a plain TEXT (no REFERENCES) because calendar_accounts
-- is a local-only table while calendar_event_imports is sync-replicated
-- — a cross-device sync push could land before the destination device
-- has finished OAuth, and a hard FK would reject the row. The CAL-04d
-- worker is the only writer and validates account_id against the local
-- calendar_accounts mirror before insert.

PRAGMA foreign_keys = OFF;

ALTER TABLE calendar_event_imports RENAME TO calendar_event_imports_old;

CREATE TABLE calendar_event_imports (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id   TEXT NOT NULL,
  raw_json      TEXT NOT NULL CHECK (json_valid(raw_json)),
  start_at      INTEGER NOT NULL,
  end_at        INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  version       INTEGER NOT NULL DEFAULT 0,
  deleted_at    INTEGER,
  UNIQUE (user_id, account_id, external_id)
) STRICT;

-- The pre-existing table had no rows in production (CAL-04 hasn't shipped),
-- but copy any test/dev rows over by mapping each event to its account via
-- (user_id, provider). If multiple accounts under the same provider exist
-- the lookup picks the oldest one; this is a best-effort dev-data preserve,
-- not a production migration path.
INSERT INTO calendar_event_imports
  (id, user_id, account_id, provider, external_id, raw_json,
   start_at, end_at, last_seen_at, version, deleted_at)
SELECT
  e.id,
  e.user_id,
  COALESCE(
    (SELECT a.id FROM calendar_accounts a
       WHERE a.user_id = e.user_id AND a.provider = e.provider
       ORDER BY a.created_at ASC LIMIT 1),
    ''
  ),
  e.provider,
  e.external_id,
  e.raw_json,
  e.start_at,
  e.end_at,
  e.last_seen_at,
  e.version,
  e.deleted_at
FROM calendar_event_imports_old e
WHERE EXISTS (
  SELECT 1 FROM calendar_accounts a
   WHERE a.user_id = e.user_id AND a.provider = e.provider
);

DROP TABLE calendar_event_imports_old;

CREATE INDEX IF NOT EXISTS calendar_event_imports_user_start_idx
  ON calendar_event_imports (user_id, start_at);
CREATE INDEX IF NOT EXISTS calendar_event_imports_account_start_idx
  ON calendar_event_imports (account_id, start_at);

PRAGMA foreign_keys = ON;
