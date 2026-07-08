import type Database from "better-sqlite3";
import { buildFtsQuery } from "./query";
import type { SearchHit, TextSegment } from "@calmly/shared";

export type { SearchHit };

const DEFAULT_LIMIT = 20;

const TASK_BM25_WEIGHTS = "bm25(task_fts, 2.0, 1.0)";
const INBOX_BM25_WEIGHTS = "bm25(inbox_fts, 1.0)";

const MARK_OPEN = "<b>";
const MARK_CLOSE = "</b>";

/** Parse FTS5 snippet output (with <b>/<\/b> markers) into safe TextSegment[]. */
function parseSegments(raw: string | null): TextSegment[] {
  if (!raw) return [];
  const segments: TextSegment[] = [];
  let rest = raw;
  while (rest.length > 0) {
    const openIdx = rest.indexOf(MARK_OPEN);
    if (openIdx === -1) {
      segments.push({ text: rest, highlighted: false });
      break;
    }
    if (openIdx > 0) {
      segments.push({ text: rest.slice(0, openIdx), highlighted: false });
    }
    rest = rest.slice(openIdx + MARK_OPEN.length);
    const closeIdx = rest.indexOf(MARK_CLOSE);
    if (closeIdx === -1) {
      segments.push({ text: rest, highlighted: true });
      break;
    }
    segments.push({ text: rest.slice(0, closeIdx), highlighted: true });
    rest = rest.slice(closeIdx + MARK_CLOSE.length);
  }
  return segments;
}

/** Truncate plain text to maxChars, appending ellipsis if needed. */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…";
}

/** Truncate segments so total visible length stays within maxChars. */
function truncateSegments(
  segs: TextSegment[],
  maxChars: number,
): TextSegment[] {
  const out: TextSegment[] = [];
  let remaining = maxChars;
  for (const seg of segs) {
    if (remaining <= 0) break;
    if (seg.text.length <= remaining) {
      out.push(seg);
      remaining -= seg.text.length;
    } else {
      out.push({
        text: seg.text.slice(0, remaining - 1) + "…",
        highlighted: seg.highlighted,
      });
      remaining = 0;
    }
  }
  return out;
}

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
        `SELECT t.id, t.title,
                -${TASK_BM25_WEIGHTS} AS score,
                snippet(task_fts, 0, '<b>', '</b>', '…', 16) AS title_snip,
                snippet(task_fts, 1, '<b>', '</b>', '…', 16) AS notes_snip
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
      title: string;
      score: number;
      title_snip: string;
      notes_snip: string;
    }>;

    return rows.map((r) => {
      const titleSegs = truncateSegments(
        parseSegments(r.title_snip || r.title),
        80,
      );
      const notesSegs = truncateSegments(parseSegments(r.notes_snip), 120);
      return {
        id: r.id,
        kind: "task" as const,
        score: r.score,
        title: truncate(r.title, 80),
        snippet: r.notes_snip ?? null,
        titleSegments: titleSegs,
        snippetSegments: notesSegs,
      };
    });
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
        `SELECT i.id, i.raw_text,
                -${INBOX_BM25_WEIGHTS} AS score,
                snippet(inbox_fts, 0, '<b>', '</b>', '…', 16) AS text_snip
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
      raw_text: string;
      score: number;
      text_snip: string;
    }>;

    return rows.map((r) => {
      const textSegs = truncateSegments(
        parseSegments(r.text_snip || r.raw_text),
        120,
      );
      const titleText = truncate(r.raw_text, 80);
      return {
        id: r.id,
        kind: "inbox" as const,
        score: r.score,
        title: titleText,
        snippet: r.text_snip ?? null,
        titleSegments: truncateSegments(parseSegments(titleText), 80),
        snippetSegments: textSegs,
      };
    });
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
  return [...tasks, ...inbox].sort((a, b) => b.score - a.score).slice(0, limit);
}
