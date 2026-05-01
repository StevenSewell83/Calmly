-- Extend ai_suggestions: nullable owner, accepted_at, edited_json
-- SQLite cannot ALTER COLUMN constraints, so recreate the table.

CREATE TABLE ai_suggestions_new (
  id TEXT PRIMARY KEY,
  owner_type TEXT CHECK (owner_type IN ('inbox_item', 'task', 'event') OR owner_type IS NULL),
  owner_id TEXT,
  model TEXT NOT NULL,
  prompt_class TEXT NOT NULL,
  suggestion_json TEXT NOT NULL CHECK (json_valid(suggestion_json)),
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'edited', 'pending')) DEFAULT 'pending',
  accepted_at INTEGER,
  edited_json TEXT CHECK (edited_json IS NULL OR json_valid(edited_json)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  version INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
) STRICT;

INSERT INTO ai_suggestions_new
  (id, owner_type, owner_id, model, prompt_class, suggestion_json, outcome, created_at, version, deleted_at)
SELECT id, owner_type, owner_id, model, prompt_class, suggestion_json, outcome, created_at, version, deleted_at
FROM ai_suggestions;

DROP TABLE ai_suggestions;

ALTER TABLE ai_suggestions_new RENAME TO ai_suggestions;

CREATE INDEX IF NOT EXISTS ai_suggestions_owner_idx ON ai_suggestions(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS ai_suggestions_prompt_class_idx ON ai_suggestions(prompt_class, outcome);
