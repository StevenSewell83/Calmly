import type { FocusSource, InboxSource, TaskStatus } from "@calmly/shared";

export interface DbHealth {
  ok: boolean;
  version: number;
  walMode: string;
  fts5: boolean;
}

export interface DbBridge {
  health(): Promise<DbHealth>;
}

export type SecretSetError =
  | "EncryptionUnavailable"
  | "InvalidKey"
  | "InvalidValue"
  | "InternalError";

export interface SecretSetResult {
  ok: boolean;
  error?: SecretSetError;
}

// The renderer only knows secret keys as strings. Validation of the allowlist
// happens in the main process — the renderer cannot bypass it by typing.
export interface SecretsBridge {
  setKey(key: string, value: string): Promise<SecretSetResult>;
  hasKey(key: string): Promise<boolean>;
  clearKey(key: string): Promise<boolean>;
  // Note: there is intentionally no getKey. Plaintext never crosses the IPC
  // boundary. Features that need a secret value perform their action in the
  // main process and only return derived results to the renderer.
}

export interface SyncStatus {
  queueSize: number;
  lastPulledVersion: number;
  lastPushedAt: number | null;
}

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  pendingAfter: number;
  lastPulledVersion: number;
  error?: string;
}

export interface SyncBridge {
  status(): Promise<SyncStatus>;
  syncNow(): Promise<SyncResult>;
}

export interface AuthUser {
  id: string;
  email: string;
}

export type RequestLinkResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_email" | "rate_limited" | "network" | "server";
    };

export type RedeemResult =
  | { ok: true; user: AuthUser; expiresAt: string }
  | {
      ok: false;
      error: "invalid_or_expired" | "invalid_request" | "network" | "server";
    };

export type StatusResult =
  | { signedIn: false }
  | { signedIn: true; user: AuthUser };

// All auth lives in the main process: HttpOnly session cookies are set on the
// API origin and the renderer cannot read them. The bridge therefore exposes
// only operations + an event subscription for deep-link redemptions, never
// raw token material.
export interface AuthBridge {
  status(): Promise<StatusResult>;
  requestLink(email: string): Promise<RequestLinkResult>;
  redeem(token: string): Promise<RedeemResult>;
  signOut(): Promise<{ ok: true }>;
  // Subscribe to deep-link redeem results pushed from main when the OS
  // delivers a calmly:// URL. Returns an unsubscribe.
  onDeepLinkRedeemed(handler: (payload: RedeemResult) => void): () => void;
}

// Renderer can only fire structured events. Log levels and message strings
// stay main-side so the renderer can't dump task content into the log file.
export interface LogBridge {
  event(name: string, props?: Record<string, unknown>): void;
}

// Mirrors the AddInboxItemResult union from main/inbox/store plus the
// NotSignedIn case the IPC layer adds. The renderer narrows on `ok` first,
// then on `error` for messaging.
export type InboxAddResult =
  | { ok: true; id: string; truncated: boolean }
  | { ok: false; error: "EmptyInput" | "NotSignedIn" | "InternalError" };

export type UnresolvedInboxCountResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" };

// Renderer-facing alias for the canonical InboxSource enum. Kept so
// existing consumers (InboxRow.tsx etc.) don't have to be touched in
// the same diff that lifts the type off @calmly/shared.
export type InboxItemSource = InboxSource;

export interface InboxItem {
  id: string;
  raw_text: string;
  source: InboxSource;
  created_at: number;
  resolved_at: number | null;
  snoozed_until: number | null;
}

export type InboxListResult =
  | { ok: true; items: InboxItem[] }
  | { ok: false; error: "NotSignedIn" };

export type InboxSnoozeResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InternalError" | "InvalidUntil";
    };

export type InboxSkipResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "NotFound" | "InternalError" };

export interface InboxBridge {
  // Persists raw text to the local inbox and queues the upsert for sync.
  // Source is hardcoded to 'desktop' main-side; the renderer cannot spoof it.
  add(rawText: string): Promise<InboxAddResult>;
  // All currently-visible inbox items (unresolved AND not actively
  // snoozed). Ordered newest-first; sort modes happen in the renderer.
  list(): Promise<InboxListResult>;
  // Mark an item as snoozed until a future timestamp. NotFound when the
  // item doesn't belong to the signed-in user (or is already deleted).
  snooze(id: string, untilMs: number): Promise<InboxSnoozeResult>;
  // Mark an item as resolved with no triage outcome (discarded).
  skip(id: string): Promise<InboxSkipResult>;
  // Number of inbox_items still awaiting triage. Drives Home's conditional
  // InboxTriageCard (hide at 0, show count + CTA otherwise).
  unresolvedCount(): Promise<UnresolvedInboxCountResult>;
  // Subscribe to global-hotkey focus pings from main. Returns an unsubscribe
  // so React effects can clean up across strict-mode double-mounts.
  onFocusRequest(handler: () => void): () => void;
}

// Today-window read shapes — mirror main/today/store.ts.
export interface TaskTodayItem {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: number | null;
  updated_at: number;
}

export interface EventTodayItem {
  id: string;
  title: string;
  start_at: number;
  end_at: number;
}

export type ListTodayTasksResult =
  | { ok: true; tasks: TaskTodayItem[] }
  | { ok: false; error: "NotSignedIn" };

export type ListTodayEventsResult =
  | { ok: true; events: EventTodayItem[] }
  | { ok: false; error: "NotSignedIn" };

export interface TasksBridge {
  // Today's tasks: in_progress (regardless of due_at) plus open tasks
  // whose due_at falls in the local-day window. Ordered Now-first.
  listToday(): Promise<ListTodayTasksResult>;
}

export interface EventsBridge {
  // Events overlapping today's local-day window, chronological.
  listToday(): Promise<ListTodayEventsResult>;
}

// Triage resolutions — each converts an inbox item into a Task / Event
// or discards it, atomically. NotFound when the item is missing for
// the current user; AlreadyResolved when another client (or this one)
// has already resolved it.
export type TriageResolveTaskResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "NotSignedIn"
        | "NotFound"
        | "AlreadyResolved"
        | "InvalidArgs"
        | "InternalError";
    };

export type TriageResolveEventResult = TriageResolveTaskResult;

export type TriageDiscardResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "NotSignedIn"
        | "NotFound"
        | "AlreadyResolved"
        | "InternalError";
    };

export interface TriageResolveAsTaskArgs {
  inboxId: string;
  title: string;
  // null when the user picked the 'Later' chip — no due date.
  dueAt: number | null;
}

export interface TriageResolveAsEventArgs {
  inboxId: string;
  title: string;
  startAt: number;
  endAt: number;
}

export interface TriageBridge {
  resolveAsTask(args: TriageResolveAsTaskArgs): Promise<TriageResolveTaskResult>;
  resolveAsEvent(
    args: TriageResolveAsEventArgs,
  ): Promise<TriageResolveEventResult>;
  discard(inboxId: string): Promise<TriageDiscardResult>;
}

// Plan view — wire shape mirrors main/plan/store.PlanTaskRow. Two
// columns per day: scheduled (placed TimeBlocks) and backlog (open
// tasks due today, unplaced).
export interface PlanTaskItem {
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
  type: string;
  parent_task_id: string | null;
}

export interface PlanForDay {
  scheduled: PlanTaskItem[];
  backlog: PlanTaskItem[];
}

export type PlanListResult =
  | { ok: true; plan: PlanForDay; day: number }
  | { ok: false; error: "NotSignedIn" };

export type PlanScheduleResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "NotSignedIn"
        | "NotFound"
        | "InvalidArgs"
        | "InternalError";
    };

export type PlanUnscheduleResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InternalError";
    };

export interface PlanScheduleArgs {
  taskId: string;
  startAt: number;
  endAt: number;
}

export interface PlanBridge {
  // Scheduled blocks + backlog for the local-day containing `day`
  // (defaults to today when omitted).
  listForDay(day?: number): Promise<PlanListResult>;
  // Place / move a task on the day grid. End must be >= start.
  schedule(args: PlanScheduleArgs): Promise<PlanScheduleResult>;
  // Return a placed task to the backlog by clearing both schedule
  // fields.
  unschedule(taskId: string): Promise<PlanUnscheduleResult>;
}

// Focus mode — local-only sessions (see migration 0008). At most one
// open session per user; start auto-ends any prior open one.
//
// FocusSourceWire kept as an alias for FocusSource so existing renderer
// consumers (focusUtils.sourceForTask) don't have to rename in the
// same diff that lifts the type off @calmly/shared.
export type FocusSourceWire = FocusSource;

export interface FocusSessionItem {
  id: string;
  user_id: string;
  task_id: string;
  started_at: number;
  ended_at: number | null;
  source: FocusSource;
}

export type FocusCurrentResult =
  | { ok: true; session: FocusSessionItem | null }
  | { ok: false; error: "NotSignedIn" };

export type FocusStartResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

export type FocusEndResult =
  | { ok: true; ended: boolean }
  | { ok: false; error: "NotSignedIn" | "InternalError" };

export type FocusMarkDoneResult =
  | { ok: true; taskId: string }
  | {
      ok: false;
      error:
        | "NotSignedIn"
        | "NoActiveSession"
        | "NotFound"
        | "InternalError";
    };

export type FocusSwitchResult = FocusStartResult;

export interface FocusStartArgs {
  taskId: string;
  source: FocusSourceWire;
}

export interface FocusBridge {
  // Returns the user's open session or null. Renderer polls this on
  // route mount + after every action.
  current(): Promise<FocusCurrentResult>;
  // Start a session. Auto-ends any prior open session.
  start(args: FocusStartArgs): Promise<FocusStartResult>;
  // End the open session. Idempotent — `ended:false` when there was
  // nothing to close.
  end(): Promise<FocusEndResult>;
  // Mark the active session's task as done AND end the session in
  // one transaction.
  markDone(): Promise<FocusMarkDoneResult>;
  // End-and-start in one transaction; renderer never sees the brief
  // 'no session' window.
  switch(args: FocusStartArgs): Promise<FocusSwitchResult>;
}

// Daily Shutdown — read summary + bulk task ops + reflection + the
// single-tx completeShutdown.
export interface ReviewTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  due_at: number | null;
  scheduled_start: number | null;
  scheduled_end: number | null;
  updated_at: number;
}

export interface ReviewReflectionItem {
  id: string;
  text: string;
}

export interface ReviewSummary {
  date: string;
  completedTasks: ReviewTaskItem[];
  unfinishedTasks: ReviewTaskItem[];
  focusedMs: number;
  reflection: ReviewReflectionItem | null;
  lastShutdownDate: string | null;
}

export type ReviewSummaryResult =
  | { ok: true; summary: ReviewSummary }
  | { ok: false; error: "NotSignedIn" };

export type ReviewBulkResult =
  | { ok: true; updated: number }
  | {
      ok: false;
      error: "NotSignedIn" | "InvalidArgs" | "InternalError";
    };

export type ReviewSaveReflectionResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "NotSignedIn" | "InvalidArgs" | "EmptyText" | "InternalError";
    };

export type ReviewCompleteShutdownResult =
  | { ok: true; reflectionId: string | null }
  | {
      ok: false;
      error: "NotSignedIn" | "InvalidArgs" | "InternalError";
    };

export interface ReviewBulkArgs {
  taskIds: string[];
}

export interface ReviewMoveToDateArgs extends ReviewBulkArgs {
  dueAt: number;
}

export interface ReviewSaveReflectionArgs {
  date: string;
  text: string;
}

export interface ReviewCompleteShutdownArgs {
  date: string;
  reflection: string | null;
}

export interface ReviewBridge {
  // Snapshot for the /review screen — completed today, unfinished
  // today, focused-ms aggregate, today's reflection (if any), and the
  // last shutdown date so the UI can show 'already closed today'.
  summary(): Promise<ReviewSummaryResult>;
  // Push due_at +24h and clear the schedule pair on each task.
  carryForward(args: ReviewBulkArgs): Promise<ReviewBulkResult>;
  // Mark each task as 'dropped'.
  drop(args: ReviewBulkArgs): Promise<ReviewBulkResult>;
  // Mark each task as 'done' (the 'I forgot to mark these earlier'
  // affordance — distinct from focus.markDone which closes a session).
  markDone(args: ReviewBulkArgs): Promise<ReviewBulkResult>;
  // Set due_at to a specific instant + clear the schedule pair.
  moveToDate(args: ReviewMoveToDateArgs): Promise<ReviewBulkResult>;
  // Upsert today's reflection. Empty/whitespace-only text is rejected
  // with EmptyText; the renderer should skip the call instead.
  saveReflection(
    args: ReviewSaveReflectionArgs,
  ): Promise<ReviewSaveReflectionResult>;
  // Single-tx close: optionally save reflection + write
  // last_shutdown_date=date into user_settings.
  completeShutdown(
    args: ReviewCompleteShutdownArgs,
  ): Promise<ReviewCompleteShutdownResult>;
}

export interface CalmlyApi {
  version: string;
  platform: string;
  db: DbBridge;
  secrets: SecretsBridge;
  sync: SyncBridge;
  auth: AuthBridge;
  inbox: InboxBridge;
  tasks: TasksBridge;
  events: EventsBridge;
  triage: TriageBridge;
  plan: PlanBridge;
  focus: FocusBridge;
  review: ReviewBridge;
  log: LogBridge;
}
