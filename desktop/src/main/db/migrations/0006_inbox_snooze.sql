-- CL-03: snooze support on inbox_items.
--
-- snoozed_until is a unix-ms timestamp. NULL means the item is visible
-- to the inbox list (or never been snoozed); a non-NULL value in the
-- future hides the item from inbox.list and inbox.unresolvedCount until
-- the timestamp passes. Snoozing does NOT touch resolved_at — a snoozed
-- item is still "unresolved", just temporarily out of sight. Skip is a
-- distinct action that sets resolved_at = now().
--
-- STRICT permits ALTER TABLE ADD COLUMN as long as the new column
-- allows NULL or has a literal DEFAULT; nullable INTEGER qualifies.

ALTER TABLE inbox_items ADD COLUMN snoozed_until INTEGER;

-- The existing inbox_items_user_idx (user_id, resolved_at) plus the
-- new partial index below keep the visibility predicate cheap. The
-- WHERE clause means SQLite only stores rows actively snoozed; once
-- they become visible again the index entry is dropped automatically.
CREATE INDEX IF NOT EXISTS inbox_items_snoozed_idx
  ON inbox_items(user_id, snoozed_until)
  WHERE snoozed_until IS NOT NULL;
