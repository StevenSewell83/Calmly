-- CAL-03: extend calendar_accounts.status to include 'reauth_required'.
--
-- SQLite does not support ALTER on CHECK constraints in-place, so we rebuild
-- the table the standard way: rename → create new → copy → drop old. Indexes
-- are recreated since they reference the original name.

PRAGMA foreign_keys = OFF;

ALTER TABLE calendar_accounts RENAME TO calendar_accounts_old;

CREATE TABLE calendar_accounts (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  provider              TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_account_id   TEXT NOT NULL,
  email                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'connected'
                          CHECK (status IN ('connected', 'disconnected', 'error', 'reauth_required')),
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;

INSERT INTO calendar_accounts
  (id, user_id, provider, external_account_id, email, status, created_at, updated_at)
SELECT id, user_id, provider, external_account_id, email, status, created_at, updated_at
  FROM calendar_accounts_old;

DROP TABLE calendar_accounts_old;

CREATE INDEX IF NOT EXISTS calendar_accounts_user_provider_idx
  ON calendar_accounts (user_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_accounts_user_provider_external_idx
  ON calendar_accounts (user_id, provider, external_account_id);

PRAGMA foreign_keys = ON;
