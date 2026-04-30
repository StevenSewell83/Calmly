-- CL-09 focus mode session state.
--
-- focus_sessions is LOCAL ONLY — not in syncTables, no server schema,
-- no version/deleted_at columns. A focus session is a per-device
-- working state ('this is what I'm doing right now'). Cross-device
-- sync of in-progress focus would be more confusing than useful per
-- PRD §11 (desktop-first ritual). Side effects that DO sync — e.g.
-- task.status='done' on markDone — flow through the regular tasks
-- upsert path.
--
-- Invariant enforced by the IPC layer: at most one open session per
-- user at a time. startFocus auto-ends any prior open session in the
-- same transaction.

CREATE TABLE focus_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  source TEXT NOT NULL CHECK (source IN ('scheduled', 'ad-hoc'))
) STRICT;

-- Partial index makes currentFocus a near-instant lookup. Once a
-- session ends, its index entry is dropped automatically.
CREATE INDEX focus_sessions_open_idx
  ON focus_sessions(user_id, ended_at)
  WHERE ended_at IS NULL;

CREATE INDEX focus_sessions_task_idx
  ON focus_sessions(task_id);
