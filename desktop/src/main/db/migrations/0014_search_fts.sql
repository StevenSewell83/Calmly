-- SRCH-01: FTS5 virtual tables for tasks, inbox items, and task notes.
--
-- External-content tables reference the base tables so FTS5 can read
-- the stored content for highlighting; triggers keep the indexes in sync.
--
-- Tokenizer: unicode61 + remove_diacritics=2 (strip combining chars,
-- e.g. "café" matches "cafe") + tokenchars='_-' (treat _ and - as word chars).

-- ── Tasks FTS ─────────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS task_fts USING fts5(
  title,
  notes,
  content='tasks',
  content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2 tokenchars '_-'"
);

-- Populate from existing rows on first run.
INSERT INTO task_fts(rowid, title, notes)
  SELECT rowid, title, COALESCE(notes, '') FROM tasks;

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO task_fts(rowid, title, notes)
    VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO task_fts(task_fts, rowid, title, notes)
    VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
  INSERT INTO task_fts(rowid, title, notes)
    VALUES (new.rowid, new.title, COALESCE(new.notes, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO task_fts(task_fts, rowid, title, notes)
    VALUES ('delete', old.rowid, old.title, COALESCE(old.notes, ''));
END;

-- ── Inbox FTS ─────────────────────────────────────────────────────────────────
CREATE VIRTUAL TABLE IF NOT EXISTS inbox_fts USING fts5(
  raw_text,
  content='inbox_items',
  content_rowid='rowid',
  tokenize="unicode61 remove_diacritics 2 tokenchars '_-'"
);

INSERT INTO inbox_fts(rowid, raw_text)
  SELECT rowid, raw_text FROM inbox_items;

CREATE TRIGGER IF NOT EXISTS inbox_items_ai AFTER INSERT ON inbox_items BEGIN
  INSERT INTO inbox_fts(rowid, raw_text) VALUES (new.rowid, new.raw_text);
END;

CREATE TRIGGER IF NOT EXISTS inbox_items_au AFTER UPDATE ON inbox_items BEGIN
  INSERT INTO inbox_fts(inbox_fts, rowid, raw_text)
    VALUES ('delete', old.rowid, old.raw_text);
  INSERT INTO inbox_fts(rowid, raw_text) VALUES (new.rowid, new.raw_text);
END;

CREATE TRIGGER IF NOT EXISTS inbox_items_ad AFTER DELETE ON inbox_items BEGIN
  INSERT INTO inbox_fts(inbox_fts, rowid, raw_text)
    VALUES ('delete', old.rowid, old.raw_text);
END;
