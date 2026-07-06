// REL-06: Auto-update state machine, driven by electron-updater's autoUpdater
// singleton (injected so tests can supply a mock EventEmitter). Calm posture:
// this module never shows a dialog and never restarts the app on its own —
// it only tracks state and exposes check()/download()/quitAndInstall() for
// the (future) Settings UI to call on user consent.
//
// Gate: entirely inert (state stays "disabled") when the app isn't packaged,
// matching `pnpm dev` boot behavior unchanged. A packaged-but-unsigned macOS
// build isn't gated ahead of time (we can't detect a missing signature
// cheaply); instead checkForUpdates()/downloadUpdate() rejections are
// classified and surface as the distinct "unsigned_mac" error code.
import type { UpdateErrorCode, UpdateStatus } from "@calmly/shared";
import { disabledUpdateStatus, idleUpdateStatus } from "@calmly/shared";

const INITIAL_CHECK_DELAY_MS = 30_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60_000;

// Minimal subset of electron-updater's `autoUpdater` this service depends
// on. Kept loose (string event names) so tests can drive it with a plain
// EventEmitter instead of the real electron-updater singleton.
export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdateServiceDeps {
  autoUpdater: AutoUpdaterLike;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
  setTimeoutFn?: typeof setTimeout;
  setIntervalFn?: typeof setInterval;
  clearTimeoutFn?: typeof clearTimeout;
  clearIntervalFn?: typeof clearInterval;
}

export interface UpdateService {
  getStatus(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  quitAndInstall(): UpdateStatus;
  subscribe(handler: (status: UpdateStatus) => void): () => void;
  // Schedules the initial delayed check + 6h recheck. No-op when disabled.
  start(): void;
  stop(): void;
}

// Exported for the IPC/unit-test layer — classifying a thrown/emitted error
// into a machine-readable code without a dialog.
export function classifyUpdateError(err: unknown, platform: NodeJS.Platform): UpdateErrorCode {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (platform === "darwin" && (lower.includes("code signature") || lower.includes("not signed"))) {
    return "unsigned_mac";
  }
  if (/enotfound|econnrefused|econnreset|etimedout|network/.test(lower)) return "offline";
  if (/\b4\d\d\b/.test(lower) || lower.includes("not found")) return "http_4xx";
  if (/\b5\d\d\b/.test(lower)) return "http_5xx";
  if (lower.includes("checksum") || lower.includes("sha512") || lower.includes("corrupt")) {
    return "corrupt_download";
  }
  return "unknown";
}

export function createUpdateService(deps: UpdateServiceDeps): UpdateService {
  const log = deps.log ?? (() => {});
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

  let status: UpdateStatus = deps.isPackaged ? idleUpdateStatus() : disabledUpdateStatus();
  const listeners = new Set<(s: UpdateStatus) => void>();
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let recheckTimer: ReturnType<typeof setInterval> | null = null;

  function setStatus(patch: Partial<UpdateStatus>): UpdateStatus {
    status = { ...status, ...patch };
    for (const listener of listeners) {
      try {
        listener(status);
      } catch {
        // A broken subscriber must not take down the update service.
      }
    }
    return status;
  }

  function onError(err: unknown): void {
    const errorCode = classifyUpdateError(err, deps.platform);
    const errorMessage = err instanceof Error ? err.message : String(err);
    log("update error", { errorCode, errorMessage });
    setStatus({ state: "error", errorCode, errorMessage });
  }

  if (deps.isPackaged) {
    deps.autoUpdater.autoDownload = false;
    deps.autoUpdater.autoInstallOnAppQuit = true;

    deps.autoUpdater.on("checking-for-update", () => {
      setStatus({ state: "checking", errorCode: null, errorMessage: null });
    });
    deps.autoUpdater.on("update-available", (...args: unknown[]) => {
      const version = (args[0] as { version?: string } | undefined)?.version ?? null;
      log("update available", { version });
      setStatus({ state: "update-available", version, progressPercent: null, errorCode: null, errorMessage: null });
    });
    deps.autoUpdater.on("update-not-available", () => {
      log("no update available");
      setStatus({ state: "idle", version: null, progressPercent: null, errorCode: null, errorMessage: null });
    });
    deps.autoUpdater.on("download-progress", (...args: unknown[]) => {
      const percent = (args[0] as { percent?: number } | undefined)?.percent ?? 0;
      setStatus({ state: "downloading", progressPercent: Math.round(percent) });
    });
    deps.autoUpdater.on("update-downloaded", (...args: unknown[]) => {
      const version = (args[0] as { version?: string } | undefined)?.version ?? status.version;
      log("update downloaded, ready to install", { version });
      setStatus({ state: "ready", version, progressPercent: 100, errorCode: null, errorMessage: null });
    });
    deps.autoUpdater.on("error", (...args: unknown[]) => onError(args[0]));
  }

  async function check(): Promise<UpdateStatus> {
    if (!deps.isPackaged) return status;
    if (status.state === "checking" || status.state === "downloading") return status;
    setStatus({ state: "checking", errorCode: null, errorMessage: null });
    try {
      await deps.autoUpdater.checkForUpdates();
    } catch (err) {
      onError(err);
    }
    return status;
  }

  async function download(): Promise<UpdateStatus> {
    if (!deps.isPackaged || status.state !== "update-available") return status;
    setStatus({ state: "downloading", progressPercent: 0 });
    try {
      await deps.autoUpdater.downloadUpdate();
    } catch (err) {
      onError(err);
    }
    return status;
  }

  function quitAndInstall(): UpdateStatus {
    if (!deps.isPackaged || status.state !== "ready") return status;
    log("quitting to install update", { version: status.version });
    deps.autoUpdater.quitAndInstall();
    return status;
  }

  function start(): void {
    if (!deps.isPackaged || initialTimer || recheckTimer) return;
    initialTimer = setTimeoutFn(() => {
      void check();
    }, INITIAL_CHECK_DELAY_MS);
    recheckTimer = setIntervalFn(() => {
      void check();
    }, RECHECK_INTERVAL_MS);
  }

  function stop(): void {
    if (initialTimer) {
      clearTimeoutFn(initialTimer);
      initialTimer = null;
    }
    if (recheckTimer) {
      clearIntervalFn(recheckTimer);
      recheckTimer = null;
    }
  }

  return {
    getStatus: () => status,
    check,
    download,
    quitAndInstall,
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    start,
    stop,
  };
}
