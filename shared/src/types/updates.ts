// REL-06: Auto-update state machine wire shapes, shared between the main
// process (source of truth) and the renderer/preload bridge. Kept here per
// house rule — no inline status string-unions in desktop/preload code.

export type UpdateState =
  | "idle"
  | "checking"
  | "update-available"
  | "downloading"
  | "ready"
  | "error"
  | "disabled";

// Machine-readable failure classification. "disabled_dev" / "unsigned_mac"
// are distinct from generic "unknown" so the (future) Settings UI can show
// calm, specific copy instead of a generic failure banner.
export type UpdateErrorCode =
  | "offline"
  | "http_4xx"
  | "http_5xx"
  | "corrupt_download"
  | "unsigned_mac"
  | "unknown";

export interface UpdateStatus {
  state: UpdateState;
  // Version string of the available/downloading/ready update, if any.
  version: string | null;
  // 0-100 while downloading; null otherwise.
  progressPercent: number | null;
  errorCode: UpdateErrorCode | null;
  errorMessage: string | null;
}

export function disabledUpdateStatus(): UpdateStatus {
  return { state: "disabled", version: null, progressPercent: null, errorCode: null, errorMessage: null };
}

export function idleUpdateStatus(): UpdateStatus {
  return { state: "idle", version: null, progressPercent: null, errorCode: null, errorMessage: null };
}
