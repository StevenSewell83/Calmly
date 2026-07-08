-- calmly-aa3.5: anchor push backoff on the last attempt, not created_at.
--
-- op_queue had no record of WHEN an op was last pushed — markAttempted only
-- bumped `attempts`. Readiness was computed as
-- created_at + backoff(attempts) <= now, so once an op was older than the
-- 60s backoff cap it was ALWAYS ready and persistently-failing ops retried
-- on every tick forever. The sync loop now anchors on last_attempted_at
-- (falling back to created_at for rows enqueued before this migration).
ALTER TABLE op_queue ADD COLUMN last_attempted_at INTEGER;
