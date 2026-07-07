import type { FocusSource, InboxSource, ReminderImportance, UpdateStatus } from "@calmly/shared";
import type {
  EventTodayRow,
  FocusSessionRow,
  InboxListRow,
  PlanTaskRow,
  ReviewTaskRow,
  TaskTodayRow,
} from "../main/wireTypes";

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
  | { ok: false; error: "InvalidArgs" | "NotSignedIn" | "InternalError" };

export type UnresolvedInboxCountResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" };

// Renderer-facing alias for the canonical InboxSource enum. Kept so
// existing consumers (InboxRow.tsx etc.) don't have to be touched in
// the same diff that lifts the type off @calmly/shared.
export type InboxItemSource = InboxSource;

// Wire shape for the inbox list IPC. Canonical definition lives in
// ../main/wireTypes — adding a column there flows to both main and
// renderer in one edit.
export type InboxItem = InboxListRow;

export type InboxListResult =
  | { ok: true; items: InboxItem[] }
  | { ok: false; error: "NotSignedIn" };

export type InboxSnoozeResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

export type InboxSkipResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError" };

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
  // Bulk-insert multiple items with source='ai-split'. Used by Brain-dump split.
  bulkAdd(texts: string[]): Promise<{ ok: boolean; count: number; error?: string }>;
  // Subscribe to global-hotkey focus pings from main. Returns an unsubscribe
  // so React effects can clean up across strict-mode double-mounts.
  onFocusRequest(handler: () => void): () => void;
}

// Today-window read shapes — re-exported from ../main/wireTypes so
// the columns the Home screen reads stay in one place.
export type TaskTodayItem = TaskTodayRow;
export type EventTodayItem = EventTodayRow;

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
        | "InvalidArgs"
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

export type TriageBreakdownResult =
  | { ok: true; parentId: string; subtaskIds: string[] }
  | { ok: false; error: "NotSignedIn" | "NotFound" | "AlreadyResolved" | "InvalidArgs" | "InternalError" };

export interface TriageResolveWithBreakdownArgs {
  inboxId: string;
  parentTitle: string;
  dueAt: number | null;
  subtasks: string[];
}

export interface TriageBridge {
  resolveAsTask(args: TriageResolveAsTaskArgs): Promise<TriageResolveTaskResult>;
  resolveAsEvent(
    args: TriageResolveAsEventArgs,
  ): Promise<TriageResolveEventResult>;
  discard(inboxId: string): Promise<TriageDiscardResult>;
  resolveWithBreakdown(args: TriageResolveWithBreakdownArgs): Promise<TriageBreakdownResult>;
}

// Plan view — wire shape re-exported from ../main/wireTypes. Two
// columns per day: scheduled (placed TimeBlocks) and backlog (open
// tasks due today, unplaced). `version` rides along on the wire so
// future optimistic-lock UI can read it without an extra fetch.
export type PlanTaskItem = PlanTaskRow;

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
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

export interface PlanScheduleArgs {
  taskId: string;
  startAt: number;
  endAt: number;
}

export interface PlanUpdateArgs {
  taskId: string;
  title?: string;
  notes?: string | null;
  dueAt?: number | null;
  scheduledStart?: number | null;
  scheduledEnd?: number | null;
}

export type PlanUpdateResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

export interface PlanMoveToDateArgs {
  taskId: string;
  /** Unix-ms timestamp of any moment on the target day (local midnight is fine). */
  targetDayMs: number;
}

export type PlanMoveToDateResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError" };

export interface PlanPushByArgs {
  taskId: string;
  /** Positive ms offset (e.g. 3_600_000 for +1 h). */
  offsetMs: number;
}

export type PlanPushByResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError" };

export type PlanDropResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "NotFound" | "InternalError" };

export interface PlanBridge {
  listForDay(day?: number): Promise<PlanListResult>;
  schedule(args: PlanScheduleArgs): Promise<PlanScheduleResult>;
  unschedule(taskId: string): Promise<PlanUnscheduleResult>;
  update(args: PlanUpdateArgs): Promise<PlanUpdateResult>;
  moveToDate(args: PlanMoveToDateArgs): Promise<PlanMoveToDateResult>;
  pushBy(args: PlanPushByArgs): Promise<PlanPushByResult>;
  /** Alias for unschedule — clears scheduled_* but keeps due_at. */
  toBacklog(taskId: string): Promise<PlanUnscheduleResult>;
  /** Clears due_at AND scheduled_* — task leaves today's plan view entirely. */
  dropFromToday(taskId: string): Promise<PlanDropResult>;
}

// Focus mode — local-only sessions (see migration 0008). At most one
// open session per user; start auto-ends any prior open one.
//
// FocusSourceWire kept as an alias for FocusSource so existing renderer
// consumers (focusUtils.sourceForTask) don't have to rename in the
// same diff that lifts the type off @calmly/shared.
export type FocusSourceWire = FocusSource;

// Focus session shape re-exported from ../main/wireTypes.
export type FocusSessionItem = FocusSessionRow;

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

export interface OpenTaskItem {
  id: string;
  title: string;
  status: string;
  due_at: number | null;
  scheduled_start: number | null;
}

export type FocusSearchResult =
  | { ok: true; tasks: OpenTaskItem[] }
  | { ok: false; error: string };

export type FocusStartAdHocResult =
  | { ok: true; sessionId: string; taskId: string }
  | { ok: false; error: string };

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
  searchOpenTasks(query: string): Promise<FocusSearchResult>;
  startAdHoc(title: string): Promise<FocusStartAdHocResult>;
  onAdHocRequest(handler: () => void): () => void;
  startStuck(): Promise<{ ok: true; stuckSessionId: string } | { ok: false; error: string }>;
  endStuck(args: { stuckSessionId: string; outcome: string; answers: { question: string; answer: string }[] }): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type ReplanReason = "ran_late" | "got_stuck" | "priorities_changed" | "other" | null;

export type ReplanActionType = "push" | "drop" | "shrink" | "moveToDate";

export interface ReplanAction {
  type: ReplanActionType;
  taskId: string;
  offsetMs?: number;
  durationMs?: number;
  targetDayMs?: number;
}

export interface ReplanBridge {
  recordEvent(reason: ReplanReason): Promise<{ ok: true } | { ok: false; error: string }>;
  applyBatch(actions: ReplanAction[]): Promise<{ ok: true; applied: number } | { ok: false; error: string }>;
}

export interface QuickPlanBridge {
  getDate(): Promise<{ ok: true; date: string | null } | { ok: false; error: string }>;
  setDate(date: string): Promise<{ ok: true } | { ok: false; error: string }>;
}

// Daily Shutdown — read summary + bulk task ops + reflection + the
// single-tx completeShutdown. ReviewTaskItem re-exported from
// ../main/wireTypes.
export type ReviewTaskItem = ReviewTaskRow;

export interface ReviewSummary {
  completed: ReviewTaskItem[];
  unfinished: ReviewTaskItem[];
  focusedMs: number;
  dateStr: string;
}

export type ReviewSummaryResult =
  | { ok: true; summary: ReviewSummary }
  | { ok: false; error: "NotSignedIn" };

export type ReviewCarryForwardResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" | "NotFound" | "InternalError" };

export type ReviewDropResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" | "InternalError" };

export type ReviewMarkDoneResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" | "InternalError" };

export type ReviewMoveToResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" | "NotFound" | "InternalError" };

export type ReviewSaveReflectionResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" | "InternalError" };

export type ReviewCompleteShutdownResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "InternalError" };

export interface ReviewBridge {
  summary(): Promise<ReviewSummaryResult>;
  carryForward(taskIds: string[]): Promise<ReviewCarryForwardResult>;
  drop(taskIds: string[]): Promise<ReviewDropResult>;
  markDone(taskIds: string[]): Promise<ReviewMarkDoneResult>;
  moveTo(taskId: string, targetDayMs: number): Promise<ReviewMoveToResult>;
  saveReflection(text: string): Promise<ReviewSaveReflectionResult>;
  completeShutdown(text: string | null): Promise<ReviewCompleteShutdownResult>;
}

export type SearchQueryResult =
  | { ok: true; hits: import("@calmly/shared").SearchHit[] }
  | { ok: false; error: "NotSignedIn" | "InternalError" };

export interface SearchBridge {
  query(q: string): Promise<SearchQueryResult>;
}

export interface SettingsBridge {
  getAppVersion(): Promise<string>;
  getSyncServerUrl(): Promise<string>;
  setSyncServerUrl(url: string): Promise<void>;
  clearSyncServerUrl(): Promise<void>;
  reindexSearch(): Promise<void>;
}

export interface CrashReportMeta {
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface CrashStatus {
  enabled: boolean;
  restartRequired: boolean;
  lastReportMeta: CrashReportMeta | null;
}

export interface CrashBridge {
  getStatus(): Promise<CrashStatus>;
  setEnabled(enabled: boolean): Promise<void>;
}

// Auto-update bridge (REL-06). No nag dialogs from the main process — the
// renderer polls getStatus()/subscribes to onStatusChanged and decides how
// (or whether) to surface it. download()/quitAndInstall() only take effect
// once the user acts; see REL-07 for the Settings UI that calls these.
export interface UpdatesBridge {
  getStatus(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  quitAndInstall(): Promise<UpdateStatus>;
  onStatusChanged(handler: (status: UpdateStatus) => void): () => void;
}

// Calendar OAuth bridge (CAL-01 / CAL-02 / CAL-03). connectGoogle and
// connectMicrosoft open the user's browser, wait for the calmly://
// deep-link, and persist the refresh token in the F-12 secret store. The
// renderer never sees refresh or access tokens — only the connection
// metadata. CAL-03 added disconnect + onAccountStatusChanged for the
// reauth-required lifecycle.
export type ListCalendarAccountsResult =
  | { ok: true; accounts: import("@calmly/shared").CalendarAccount[] }
  | { ok: false; error: "NotSignedIn" };

export type DisconnectCalendarResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "NotSignedIn"
        | "NotFound"
        | "InvalidArgs"
        | "InternalError";
    };

export interface AccountStatusEventPayload {
  accountId: string;
  status: import("@calmly/shared").CalendarAccountStatus;
}

export interface CalendarDayEvent {
  id: string;
  provider: "google" | "microsoft";
  title: string;
  startMs: number;
  endMs: number;
  isAllDay: boolean;
  location?: string;
}

export type ListCalendarDayEventsResult =
  | { ok: true; events: CalendarDayEvent[] }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export interface CalendarBridge {
  connectGoogle(): Promise<import("@calmly/shared").CalendarConnectResult>;
  connectMicrosoft(): Promise<import("@calmly/shared").CalendarConnectResult>;
  listAccounts(): Promise<ListCalendarAccountsResult>;
  disconnect(accountId: string): Promise<DisconnectCalendarResult>;
  refresh(accountId?: string): Promise<{ ok: boolean }>;
  listEventsForDay(dayIso: string): Promise<ListCalendarDayEventsResult>;
  onAccountStatusChanged(
    handler: (event: AccountStatusEventPayload) => void,
  ): () => void;
}

// AI v1 BYO-key bridge (AI1-01). Toggle + Cloud-only mode + Anthropic key
// stored in the F-12 encrypted secret store. testConnection performs a
// minimal probe call; plaintext keys never cross the IPC boundary.
export interface AiSettings {
  enabled: boolean;
  mode: "off" | "cloud";
}

export type AiTestResult =
  | { ok: true }
  | { ok: false; error: "NoKey" | "InvalidKey" | "NetworkError" | "InternalError"; message?: string };

export type AIAction = "triage_cleanup" | "make_startable" | "brain_dump_split";

export type AIError =
  | { kind: "auth" }
  | { kind: "quota" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "invalid_response"; raw?: string }
  | { kind: "unknown"; cause?: unknown };

export type AIRunResult =
  | { ok: true; value: { action: AIAction; result: unknown; suggestionId: string } }
  | { ok: false; error: AIError };

export type SuggestionOutcome = "accepted" | "rejected" | "edited";

export interface AiBridge {
  getSettings(): Promise<AiSettings>;
  setSettings(patch: Partial<AiSettings>): Promise<{ ok: boolean; error?: string }>;
  hasKey(): Promise<boolean>;
  setKey(value: string): Promise<{ ok: boolean; error?: string }>;
  clearKey(): Promise<boolean>;
  testConnection(): Promise<AiTestResult>;
  run(action: AIAction, payload: Record<string, unknown>, ownerType?: string, ownerId?: string): Promise<AIRunResult>;
  recordOutcome(suggestionId: string, outcome: SuggestionOutcome, editedJson?: unknown): Promise<{ ok: boolean; error?: string }>;
  getUsage(): Promise<{
    ok: boolean;
    usage?: {
      totalRequests: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      byPromptClass: Record<string, { requests: number; inputTokens: number; outputTokens: number }>;
    };
    rateLimiter?: { suspended: boolean; suspendedUntilMs: number };
  }>;
}

// Per-task reminder rule wire shape — mirrors ReminderRuleRow in
// main/reminders/store. Renderer treats `active` as 0|1 to keep one
// shape between SQLite and the bridge.
export interface ReminderRuleItem {
  id: string;
  task_id: string;
  importance: ReminderImportance;
  interval_seconds: number;
  escalation_json: string;
  active: 0 | 1;
  version: number;
}

export interface RemindersUpsertArgs {
  taskId: string;
  importance: ReminderImportance;
  intervalSeconds: number;
  /** Serialized JSON object — escalation policy. The shape is the
   * reminders epic's concern; this layer just round-trips a string. */
  escalationJson: string;
  active: boolean;
}

export type RemindersGetResult =
  | { ok: true; rule: ReminderRuleItem | null }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export type RemindersUpsertResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

export type RemindersDeleteResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

// RM-02 profile defaults (Important/Soft interval applied to a task's rule
// when it's first created). Stored on the shared user_settings blob, not a
// new table — see main/ipc/reminders.ts.
export interface ReminderDefaults {
  importantIntervalSeconds: number;
  softIntervalSeconds: number;
}

export type RemindersGetDefaultsResult =
  | { ok: true; defaults: ReminderDefaults }
  | { ok: false; error: "NotSignedIn" };

export type RemindersSetDefaultsResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export interface RemindersBridge {
  get(taskId: string): Promise<RemindersGetResult>;
  upsert(args: RemindersUpsertArgs): Promise<RemindersUpsertResult>;
  delete(taskId: string): Promise<RemindersDeleteResult>;
  getDefaults(): Promise<RemindersGetDefaultsResult>;
  setDefaults(patch: Partial<ReminderDefaults>): Promise<RemindersSetDefaultsResult>;
}

// Telegram linking bridge (TGR-06). Mirrors server/src/telegram/linkingRoutes.ts
// (TG-02b) exactly: the server only ever returns chatId, never a username (see
// linking.ts's comment on why telegram_username isn't a stored column yet), so
// the Linked state below is deliberately chatId + linkedAt rather than the
// "@username" the original TG-08 spec assumed.
export type TelegramLinkingStatusResult =
  | { ok: true; linked: false }
  | { ok: true; linked: true; chatId: string; linkedAt: number }
  | { ok: false; error: "NotSignedIn" | "NetworkError" | "InternalError" };

// botUsername is best-effort (sourced from GET /telegram/health alongside the
// code creation call) — null when that lookup fails, in which case the
// renderer falls back to "message the bot with this code" copy instead of a
// clickable t.me deep link.
export type TelegramCreateCodeResult =
  | { ok: true; code: string; expiresAt: number; botUsername: string | null }
  | {
      ok: false;
      error: "NotSignedIn" | "RateLimited" | "NetworkError" | "InternalError";
    };

export type TelegramUnlinkResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "NetworkError" | "InternalError" };

export interface TelegramBridge {
  getStatus(): Promise<TelegramLinkingStatusResult>;
  createLinkingCode(): Promise<TelegramCreateCodeResult>;
  unlink(): Promise<TelegramUnlinkResult>;
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
  quickplan: QuickPlanBridge;
  replan: ReplanBridge;
  review: ReviewBridge;
  reminders: RemindersBridge;
  log: LogBridge;
  settings: SettingsBridge;
  search: SearchBridge;
  calendar: CalendarBridge;
  ai: AiBridge;
  crash: CrashBridge;
  updates: UpdatesBridge;
  telegram: TelegramBridge;
}
