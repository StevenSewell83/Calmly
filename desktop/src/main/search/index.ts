import type Database from "better-sqlite3";
import { buildFtsQuery } from "./query";

export interface SearchHit {
  id: string;
  kind: "task" | "inbox";
  score: number;
  snippet: string | null;
}

const DEFAULT_LIMIT = 20;

// BM25 weights: title=2x, notes=1x (FTS5 bm25() returns negative — lower is better).
// We negate to produce a positive "score" for callers.
const TASK_BM25_WEIGHTS = "bm25(task_fts, 2.0, 1.0)";
const INBOX_BM25_WEIGHTS = "bm25(inbox_fts, 1.0)";

export function searchTasks(
  db: Database.Database,
  userId: string,
  raw: string,
  limit = DEFAULT_LIMIT,
): SearchHit[] {
  const q = buildFtsQuery(raw);
  if (!q) return [];
  try {
    const rows = db
      .prepare(
        `SELECT t.id, -${TASK_BM25_WEIGHTS} AS score,
                snippet(task_fts, 0, '<b>', '</b>', '…', 8) AS snippet
         FROM task_fts
         JOIN tasks t ON t.rowid = task_fts.rowid
         WHERE task_fts MATCH ?
           AND t.user_id = ?
           AND t.deleted_at IS NULL
         ORDER BY score DESC
         LIMIT ?`,
      )
      .all(q, userId, limit) as Array<{
      id: string;
      score: number;
      snippet: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      kind: "task" as const,
      score: r.score,
      snippet: r.snippet ?? null,
    }));
  } catch {
    return [];
  }
}

export function searchInbox(
  db: Database.Database,
  userId: string,
  raw: string,
  limit = DEFAULT_LIMIT,
): SearchHit[] {
  const q = buildFtsQuery(raw);
  if (!q) return [];
  try {
    const rows = db
      .prepare(
        `SELECT i.id, -${INBOX_BM25_WEIGHTS} AS score,
                snippet(inbox_fts, 0, '<b>', '</b>', '…', 8) AS snippet
         FROM inbox_fts
         JOIN inbox_items i ON i.rowid = inbox_fts.rowid
         WHERE inbox_fts MATCH ?
           AND i.user_id = ?
           AND i.deleted_at IS NULL
         ORDER BY score DESC
         LIMIT ?`,
      )
      .all(q, userId, limit) as Array<{
      id: string;
      score: number;
      snippet: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      kind: "inbox" as const,
      score: r.score,
      snippet: r.snippet ?? null,
    }));
  } catch {
    return [];
  }
}

export function searchAll(
  db: Database.Database,
  userId: string,
  raw: string,
  limit = DEFAULT_LIMIT,
): SearchHit[] {
  const tasks = searchTasks(db, userId, raw, limit);
  const inbox = searchInbox(db, userId, raw, limit);
  return [...tasks, ...inbox]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
