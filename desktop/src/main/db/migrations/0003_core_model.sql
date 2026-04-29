-- F-05 core data-model schema (PRD §14).
-- Conventions used throughout:
--   * IDs are TEXT UUIDs so they're stable across devices for sync.
--   * Timestamps are INTEGER unix milliseconds via unixepoch()*1000.
--   * Enum-like columns are TEXT with CHECK constraints so the DB enforces them.
--   * JSON columns are TEXT with CHECK(json_valid(...)).
--   * STRICT tables enforce declared types; rejects sloppy inserts.
--   * User-owned children FK to users(id) ON DELETE CASCADE.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  -- Magic-link token is stored as a hash + expiry; raw token never persists.
  magic_link_token_hash TEXT,
  magic_link_expires_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;

CREATE TABLE inbox_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('desktop', 'telegram-text', 'telegram-voice', 'ai-split')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  resolved_at INTEGER
) STRICT;
CREATE INDEX inbox_items_user_idx ON inbox_items(user_id, resolved_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  type TEXT NOT NULL DEFAULT 'task',
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done', 'dropped', 'snoozed')) DEFAULT 'open',
  due_at INTEGER,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('desktop', 'telegram-text', 'telegram-voice', 'ai-split')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;
CREATE INDEX tasks_user_status_idx ON tasks(user_id, status);
CREATE INDEX tasks_due_at_idx ON tasks(user_id, due_at) WHERE due_at IS NOT NULL;
CREATE INDEX tasks_parent_idx ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('manual', 'calendar-import')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;
CREATE INDEX events_user_start_idx ON events(user_id, start_at);

CREATE TABLE reminder_rules (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  importance TEXT NOT NULL CHECK (importance IN ('important', 'soft')),
  interval_seconds INTEGER NOT NULL CHECK (interval_seconds > 0),
  -- Escalation policy is a JSON object; specific shape lives in the reminders epic.
  escalation_json TEXT NOT NULL CHECK (json_valid(escalation_json)),
  active INTEGER NOT NULL CHECK (active IN (0, 1)) DEFAULT 1
) STRICT;
CREATE INDEX reminder_rules_task_idx ON reminder_rules(task_id);

CREATE TABLE recurrence_rules (
  id TEXT PRIMARY KEY,
  -- Polymorphic FK: SQLite can't enforce, owner_type is the discriminator.
  owner_type TEXT NOT NULL CHECK (owner_type IN ('task', 'reminder')),
  owner_id TEXT NOT NULL,
  rrule_text TEXT NOT NULL
) STRICT;
CREATE INDEX recurrence_rules_owner_idx ON recurrence_rules(owner_type, owner_id);

CREATE TABLE calendar_event_imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id TEXT NOT NULL,
  raw_json TEXT NOT NULL CHECK (json_valid(raw_json)),
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE (user_id, provider, external_id)
) STRICT;
CREATE INDEX calendar_event_imports_user_start_idx ON calendar_event_imports(user_id, start_at);

CREATE TABLE ai_suggestions (
  id TEXT PRIMARY KEY,
  -- Polymorphic FK: SQLite can't enforce, owner_type is the discriminator.
  owner_type TEXT NOT NULL CHECK (owner_type IN ('inbox_item', 'task', 'event')),
  owner_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_class TEXT NOT NULL,
  suggestion_json TEXT NOT NULL CHECK (json_valid(suggestion_json)),
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'rejected', 'edited', 'pending')) DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;
CREATE INDEX ai_suggestions_owner_idx ON ai_suggestions(owner_type, owner_id);

CREATE TABLE telegram_links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL UNIQUE,
  linked_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;
CREATE INDEX telegram_links_user_idx ON telegram_links(user_id);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Settings shape is versioned inside the JSON; new fields don't require migrations.
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;
