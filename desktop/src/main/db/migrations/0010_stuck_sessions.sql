-- CL-10: Stuck rescue sessions. Local-only (no sync columns needed).
-- outcome: 'continue' | 'switch' | 'break' | 'abandoned'
CREATE TABLE IF NOT EXISTS stuck_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  focus_session_id TEXT NOT NULL REFERENCES focus_sessions(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,
  answers_json TEXT NOT NULL DEFAULT '[]'
) STRICT;
