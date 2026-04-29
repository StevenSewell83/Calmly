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

export interface InboxBridge {
  // Persists raw text to the local inbox and queues the upsert for sync.
  // Source is hardcoded to 'desktop' main-side; the renderer cannot spoof it.
  add(rawText: string): Promise<InboxAddResult>;
  // Number of inbox_items still awaiting triage. Drives Home's conditional
  // InboxTriageCard (hide at 0, show count + CTA otherwise).
  unresolvedCount(): Promise<UnresolvedInboxCountResult>;
  // Subscribe to global-hotkey focus pings from main. Returns an unsubscribe
  // so React effects can clean up across strict-mode double-mounts.
  onFocusRequest(handler: () => void): () => void;
}

// Today-window read shapes — mirror main/today/store.ts. Status is the
// shared TaskStatus enum but kept as a string here so the renderer
// doesn't need to depend on @calmly/shared at type-level.
export interface TaskTodayItem {
  id: string;
  title: string;
  status: "open" | "in_progress" | "done" | "dropped" | "snoozed";
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
  log: LogBridge;
}
