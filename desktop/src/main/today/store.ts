import type Database from "better-sqlite3";
import type { TaskTodayRow, EventTodayRow } from "../wireTypes";

// Read-side helpers that drive the Home screen. Each function is a pure
// query builder — given a db, a user, and a "now" instant, return the
// rows for that local-day window. Keeping `now` and `tzOffsetMinutes`
// as args (rather than reading the system clock inside) makes the unit
// tests deterministic across machines and timezones.
//
// Row interfaces (TaskTodayRow, EventTodayRow) live in main/wireTypes.ts
// so preload/api-types.ts can import them under the web tsconfig.
export type { TaskTodayRow, EventTodayRow };

const DAY_MS = 24 * 60 * 60 * 1000;

// Computes the [start, endExclusive) ms window for the local day that
// contains `now`. tzOffsetMinutes follows the JS Date convention:
// positive when the local zone is BEHIND UTC (e.g. +480 for PST). For
// most callers, pass `new Date().getTimezoneOffset()` directly.
export function localDayWindow(
  now: number,
  tzOffsetMinutes: number,
): { start: number; endExclusive: number } {
  // Shift by -offset to land in "local epoch" space, floor to the day,
  // then shift back. (Date.getTimezoneOffset returns offset to ADD to
  // local time to get UTC, hence the subtraction here.)
  const localNow = now - tzOffsetMinutes * 60 * 1000;
  const localStart = Math.floor(localNow / DAY_MS) * DAY_MS;
  const start = localStart + tzOffsetMinutes * 60 * 1000;
  return { start, endExclusive: start + DAY_MS };
}

// Tasks shown on the Home screen. We include in_progress regardless of
// due_at (so a focus session started yesterday still shows in Now), and
// 'open' tasks whose due_at is anywhere inside today. Done/dropped/
// snoozed are out — Review owns the completed list, snoozed surfaces
// when the snooze elapses (handled elsewhere).
export function listTodayTasks(
  db: Database.Database,
  userId: string,
  now: number,
  tzOffsetMinutes: number,
): TaskTodayRow[] {
  const { start, endExclusive } = localDayWindow(now, tzOffsetMinutes);
  const rows = db
    .prepare(
      `SELECT id, title, status, due_at, updated_at
         FROM tasks
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND (
            status = 'in_progress'
            OR (status = 'open' AND due_at IS NOT NULL AND due_at >= ? AND due_at < ?)
          )
        ORDER BY
          -- in_progress first (Now slot), then chronological by due_at,
          -- then created_at as a tiebreaker for tasks with no due_at
          -- (only the in_progress branch reaches here without a due_at).
          CASE WHEN status = 'in_progress' THEN 0 ELSE 1 END,
          COALESCE(due_at, updated_at) ASC`,
    )
    .all(userId, start, endExclusive) as TaskTodayRow[];
  return rows;
}

// Events that overlap today's window. Calendar imports + manual events
// share the same surface — the source field stays internal here.
export function listTodayEvents(
  db: Database.Database,
  userId: string,
  now: number,
  tzOffsetMinutes: number,
): EventTodayRow[] {
  const { start, endExclusive } = localDayWindow(now, tzOffsetMinutes);
  const rows = db
    .prepare(
      `SELECT id, title, start_at, end_at
         FROM events
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND start_at < ?
          AND end_at > ?
        ORDER BY start_at ASC`,
    )
    .all(userId, endExclusive, start) as EventTodayRow[];
  return rows;
}

// Count of inbox items still awaiting triage AND currently visible
// (not actively snoozed). Drives the conditional InboxTriageCard on
// Home — keeping the same predicate as listInbox so the badge count
// matches the row count the user sees on /inbox.
export function countUnresolvedInbox(
  db: Database.Database,
  userId: string,
  now: number,
): number {
  const r = db
    .prepare(
      `SELECT count(*) AS c
         FROM inbox_items
        WHERE user_id = ?
          AND deleted_at IS NULL
          AND resolved_at IS NULL
          AND (snoozed_until IS NULL OR snoozed_until <= ?)`,
    )
    .get(userId, now) as { c: number } | undefined;
  return r?.c ?? 0;
}
