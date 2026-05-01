import type { FocusSource, InboxSource, TaskStatus } from "@calmly/shared";

// REFACTOR-AUDIT-2b: single home for the row shapes that travel
// across the IPC boundary. Living here (vs inside each feature
// store.ts) lets the preload-facing api-types.ts import them under
// the web tsconfig — main/<feature>/store.ts pulls in better-sqlite3
// and the sync queue, which are out of scope for the renderer's
// composite project file list.
//
// Anti-drift: every renderer-visible row shape goes here. The
// matching feature store re-exports its row type from this file so
// existing main-side imports (`InboxListRow` from
// `../inbox/store`) keep working.

export interface InboxListRow {
  id: string;
  raw_text: string;
  source: InboxSource;
  created_at: number;
  resolved_at: number | null;
  snoozed_until: number | null;
}

export interface TaskTodayRow {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: number | null;
  updated_at: number;
}

export interface EventTodayRow {
  id: string;
  title: string;
  start_at: number;
  end_at: number;
}

export interface PlanTaskRow {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_at: number | null;
  scheduled_start: number | null;
  scheduled_end: number | null;
  source: InboxSource;
  created_at: number;
  updated_at: number;
  version: number;
  type: string;
  parent_task_id: string | null;
}

export interface FocusSessionRow {
  id: string;
  user_id: string;
  task_id: string;
  started_at: number;
  ended_at: number | null;
  source: FocusSource;
}

export interface ReviewTaskRow {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  due_at: number | null;
  scheduled_start: number | null;
  scheduled_end: number | null;
}
