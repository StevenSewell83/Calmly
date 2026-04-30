import type Database from "better-sqlite3";
import { localDayWindow } from "../today/store";
import type { ReviewTaskRow } from "../wireTypes";

// CL-13 Daily Shutdown read path. Builds the day's review snapshot in
// three task reads + one focus aggregate + one settings lookup so the
// renderer can render the whole screen from a single IPC call.
//
// ReviewTaskRow lives in main/wireTypes.ts (re-exported here for
// back-compat with consumers that already import from this module).
export type { ReviewTaskRow };

export interface ReviewReflection {
  id: string;
  text: string;
}

export interface ReviewSummary {
  date: string;
  completedTasks: ReviewTaskRow[];
  unfinishedTasks: ReviewTaskRow[];
  focusedMs: number;
  reflection: ReviewReflection | null;
  lastShutdownDate: string | null;
}

const SUMMARY_COLS =
  "id, title, status, due_at, scheduled_start, scheduled_end, updated_at";

// Returns 'YYYY-MM-DD' for the user-local date that contains `now`.
// Same tz convention as today/store.localDayWindow.
export function localDateString(now: number, tzOffsetMinutes: number): string {
  const localMs = now - tzOffsetMinutes * 60 * 1000;
  const d = new Date(localMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function summarize(
  db: Database.Database,
  userId: string,
  now: number,
  tzOffsetMinutes: number,
): ReviewSummary {
  const { start, endExclusive } = localDayWindow(now, tzOffsetMinutes);
  const date = localDateString(now, tzOffsetMinutes);

  const completedTasks = db
    .prepare(
      `SELECT ${SUMMARY_COLS}
         FROM tasks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND status = 'done'
          AND updated_at >= ? AND updated_at < ?
        ORDER BY updated_at ASC`,
    )
    .all(userId, start, endExclusive) as ReviewTaskRow[];

  const unfinishedTasks = db
    .prepare(
      `SELECT ${SUMMARY_COLS}
         FROM tasks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND status IN ('open', 'in_progress')
          AND (
            (due_at IS NOT NULL AND due_at >= ? AND due_at < ?)
            OR (scheduled_start IS NOT NULL AND scheduled_start >= ? AND scheduled_start < ?)
          )
        ORDER BY COALESCE(scheduled_start, due_at, updated_at) ASC`,
    )
    .all(
      userId,
      start,
      endExclusive,
      start,
      endExclusive,
    ) as ReviewTaskRow[];

  // Sum of session durations whose start falls in today's window.
  // Open sessions count up to `now`; closed sessions clamp at
  // endExclusive so a session that runs past midnight contributes only
  // its today portion.
  const focusedRow = db
    .prepare(
      `SELECT COALESCE(SUM(
                MIN(COALESCE(ended_at, ?), ?) - started_at
              ), 0) AS ms
         FROM focus_sessions
        WHERE user_id = ?
          AND started_at >= ? AND started_at < ?`,
    )
    .get(now, endExclusive, userId, start, endExclusive) as
    | { ms: number }
    | undefined;

  const reflectionRow = db
    .prepare(
      `SELECT id, text FROM daily_reflections
        WHERE user_id = ? AND date = ? AND deleted_at IS NULL`,
    )
    .get(userId, date) as ReviewReflection | undefined;

  const settingsRow = db
    .prepare(
      `SELECT settings_json FROM user_settings
        WHERE user_id = ? AND deleted_at IS NULL`,
    )
    .get(userId) as { settings_json: string } | undefined;
  const lastShutdownDate = readLastShutdownDate(settingsRow?.settings_json);

  return {
    date,
    completedTasks,
    unfinishedTasks,
    focusedMs: Math.max(0, focusedRow?.ms ?? 0),
    reflection: reflectionRow ?? null,
    lastShutdownDate,
  };
}

function readLastShutdownDate(json: string | undefined): string | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const v = parsed["last_shutdown_date"];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}
