-- CAL-01: local mirror of calendar_accounts.
--
-- Server-side calendar_accounts is the source of truth for account identity
-- (id, external_account_id, email). This local table mirrors it so the
-- renderer can render connection status without a server round-trip and
-- so subsequent jobs (CAL-04 import worker) can scope their queries.
--
-- The refresh token does NOT live here — it lives in `secrets` under the
-- key `calendar.google.refresh_token:<account_id>` (and microsoft for CAL-02).
-- This table is local-only, NOT sync-replicated.

CREATE TABLE IF NOT EXISTS calendar_accounts (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL,
  provider              TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_account_id   TEXT NOT NULL,
  email                 TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'connected'
                          CHECK (status IN ('connected', 'disconnected', 'error')),
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;

CREATE INDEX IF NOT EXISTS calendar_accounts_user_provider_idx
  ON calendar_accounts (user_id, provider);

CREATE UNIQUE INDEX IF NOT EXISTS calendar_accounts_user_provider_external_idx
  ON calendar_accounts (user_id, provider, external_account_id);
