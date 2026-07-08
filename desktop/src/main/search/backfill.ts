// backfill.ts — chunked FTS re-index for pre-existing rows.
//
// Runs once after app boot. Checks _search_meta for `version=14`; if the
// status is not 'done', re-indexes all tasks and inbox_items in batches of
// 500 rows with setImmediate between chunks so the main-process event loop
// stays responsive during startup.
//
// Concurrency: only one backfill per process. Re-entrant calls are dropped.

import type Database from "better-sqlite3";

const FTS_VERSION = 14;
const BATCH_SIZE = 500;
const LOG_EVERY = 5000;

let running = false;

interface SearchMeta {
  version: number;
  status: string;
}

function getMetaStatus(db: Database.Database): string | null {
  try {
    const row = db
      .prepare("SELECT status FROM _search_meta WHERE version = ?")
      .get(FTS_VERSION) as SearchMeta | undefined;
    return row?.status ?? null;
  } catch {
    return null;
  }
}

function setStatus(
  db: Database.Database,
  status: "pending" | "running" | "done" | "error",
  extra: { startedAt?: number; finishedAt?: number; rowCount?: number } = {},
): void {
  db.prepare(
    `INSERT INTO _search_meta (version, status, started_at, finished_at, row_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(version) DO UPDATE SET
       status=excluded.status,
       started_at=COALESCE(excluded.started_at, started_at),
       finished_at=excluded.finished_at,
       row_count=excluded.row_count`,
  ).run(
    FTS_VERSION,
    status,
    extra.startedAt ?? null,
    extra.finishedAt ?? null,
    extra.rowCount ?? null,
  );
}

/**
 * Runs the FTS backfill if needed. Safe to call on every boot; it is a no-op
 * when status is already 'done'. Pass `force=true` to re-index unconditionally
 * (used by the "Reindex search" Settings button).
 */
export function runSearchBackfill(
  db: Database.Database,
  log: {
    info(msg: string, data?: object): void;
    debug(msg: string, data?: object): void;
  },
  force = false,
): void {
  if (running) return;

  const status = getMetaStatus(db);
  if (!force && status === "done") {
    log.debug("[search] FTS index up-to-date, skipping backfill");
    return;
  }

  running = true;
  const startedAt = Date.now();
  setStatus(db, "running", { startedAt });
  log.info("[search] FTS backfill starting");

  let totalRows = 0;

  // Collect all rowids for tasks + inbox_items first (fast read).
  const taskRowids = (
    db
      .prepare("SELECT rowid FROM tasks WHERE deleted_at IS NULL")
      .all() as Array<{ rowid: number }>
  ).map((r) => r.rowid);

  const inboxRowids = (
    db
      .prepare("SELECT rowid FROM inbox_items WHERE deleted_at IS NULL")
      .all() as Array<{ rowid: number }>
  ).map((r) => r.rowid);

  // Clear existing FTS content so we start fresh.
  db.prepare("DELETE FROM task_fts").run();
  db.prepare("DELETE FROM inbox_fts").run();

  function processBatch(
    rowids: number[],
    offset: number,
    table: "tasks" | "inbox_items",
    fts: "task_fts" | "inbox_fts",
    columns: string[],
  ): void {
    const batch = rowids.slice(offset, offset + BATCH_SIZE);
    if (batch.length === 0) {
      // Done with this table — move to inbox if needed, or finish.
      if (table === "tasks") {
        // Start inbox backfill
        scheduleInbox(0);
      } else {
        finish();
      }
      return;
    }

    const placeholders = batch.map(() => "?").join(",");
    const cols = columns.join(", ");
    const ftsInsert = db.prepare(
      `INSERT INTO ${fts}(rowid, ${cols})
       SELECT rowid, ${columns.map((c) => (c === "notes" ? `COALESCE(${c}, '')` : c)).join(", ")}
       FROM ${table}
       WHERE rowid IN (${placeholders})`,
    );
    const tx = db.transaction(() => ftsInsert.run(...batch));
    tx();

    totalRows += batch.length;
    if (totalRows % LOG_EVERY < BATCH_SIZE) {
      log.debug("[search] FTS backfill progress", { totalRows });
    }

    setImmediate(() =>
      processBatch(rowids, offset + BATCH_SIZE, table, fts, columns),
    );
  }

  function scheduleTasks(offset: number) {
    setImmediate(() =>
      processBatch(taskRowids, offset, "tasks", "task_fts", ["title", "notes"]),
    );
  }

  function scheduleInbox(offset: number) {
    setImmediate(() =>
      processBatch(inboxRowids, offset, "inbox_items", "inbox_fts", [
        "raw_text",
      ]),
    );
  }

  function finish() {
    const finishedAt = Date.now();
    setStatus(db, "done", { startedAt, finishedAt, rowCount: totalRows });
    running = false;
    log.info("[search] FTS backfill complete", {
      totalRows,
      ms: finishedAt - startedAt,
    });
  }

  scheduleTasks(0);
}

/** Resets backfill marker and re-runs the full index. */
export function reindexSearch(
  db: Database.Database,
  log: {
    info(msg: string, data?: object): void;
    debug(msg: string, data?: object): void;
  },
): void {
  setStatus(db, "pending");
  runSearchBackfill(db, log, true);
}
