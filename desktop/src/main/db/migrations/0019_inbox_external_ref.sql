-- TG-03a: inbox_items.external_ref + 'manual-split' source CHECK fix.
--
-- Pairs with server migration 0011_inbox_external_ref.cjs and the
-- shared model update in shared/src/model/inbox.ts.
--
-- Two changes need to land together:
--   1. Add external_ref TEXT NULL so the bot's idempotent insert path
--      can persist a 'tg:<chat_id>:<message_id>' marker and detect
--      Telegram retry replays. Null on rows captured from desktop.
--   2. Extend the source CHECK to include 'manual-split' for parity
--      with the shared InboxSourceSchema enum. The desktop tasks
--      source CHECK was extended in 0013 (CL-05); inbox_items was
--      missed at that time. SQLite cannot ALTER a CHECK in place, so
--      the column add piggybacks on the table rebuild.
--
-- A partial unique index (user_id, external_ref) WHERE external_ref
-- IS NOT NULL gives the bot's ON CONFLICT path something to collide
-- on without false-positive collisions on the NULL desktop rows.

PRAGMA foreign_keys = OFF;

CREATE TABLE inbox_items_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (
    source IN ('desktop','telegram-text','telegram-voice','ai-split','manual-split')
  ),
  external_ref TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  resolved_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  snoozed_until INTEGER
) STRICT;

INSERT INTO inbox_items_new
  (id, user_id, raw_text, source, external_ref, created_at, resolved_at,
   version, deleted_at, snoozed_until)
SELECT
  id, user_id, raw_text, source, NULL, created_at, resolved_at,
  version, deleted_at, snoozed_until
FROM inbox_items;

DROP TABLE inbox_items;
ALTER TABLE inbox_items_new RENAME TO inbox_items;

CREATE INDEX IF NOT EXISTS inbox_items_user_idx
  ON inbox_items (user_id, resolved_at);
-- Recreate the partial snooze index (originally added in 0006) since
-- the table rebuild dropped it alongside the old definition.
CREATE INDEX IF NOT EXISTS inbox_items_snoozed_idx
  ON inbox_items (user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_items_user_external_ref_unique
  ON inbox_items (user_id, external_ref) WHERE external_ref IS NOT NULL;

PRAGMA foreign_keys = ON;
