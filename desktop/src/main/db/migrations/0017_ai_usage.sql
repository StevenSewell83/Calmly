CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  prompt_class TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS ai_usage_user_ts_idx ON ai_usage(user_id, ts);
CREATE INDEX IF NOT EXISTS ai_usage_prompt_class_idx ON ai_usage(user_id, prompt_class, ts);
