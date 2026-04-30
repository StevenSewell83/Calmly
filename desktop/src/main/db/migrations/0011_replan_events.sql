-- CL-12: Replan events for telemetry. Local-only.
-- reason: 'ran_late' | 'got_stuck' | 'priorities_changed' | 'other' | null
CREATE TABLE IF NOT EXISTS replan_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
) STRICT;
