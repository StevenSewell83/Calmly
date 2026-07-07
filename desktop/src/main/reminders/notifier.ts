// TGR-10 — turns a pending desktop-channel delivery (server/src/reminders/
// channels/desktop.ts) into a native Notification. There is no live push
// transport (see deliveriesClient.ts's header), so this module's poll loop
// runs on its own timer at the same cadence as the sync loop
// (bootstrap/notifier-bootstrap.ts wires the interval) rather than being
// woven into sync/loop.ts's runSyncOnce — that module is generic to the
// synced tables (tasks, events, ...) and a Notification side effect would
// blur its single responsibility.
//
// Kept free of any "electron" import (mirrors updates/updateService.ts's
// AutoUpdaterLike dependency-injection) so this module is unit-testable
// with plain fakes; the real Notification/BrowserWindow are wired only at
// the bootstrap layer (notifier-bootstrap.ts).
import type { DesktopDeliveriesClient, PendingDesktopDelivery } from "./deliveriesClient";

export const OPEN_TASK_CHANNEL = "reminders:open-task";
const BELL_PREFIX = "\u{1F514} ";

export interface NotificationLike {
  show(): void;
  on(event: "click", listener: () => void): unknown;
}

export interface WindowLike {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: { send(channel: string, payload: unknown): void };
}

export interface NotifierDeps {
  client: DesktopDeliveriesClient;
  getMainWindow: () => WindowLike | null;
  // Packaged builds carry the release epic's AppUserModelID; without it
  // (dev) Windows in particular can silently drop native notifications.
  isPackaged: boolean;
  isNotificationSupported: () => boolean;
  createNotification: (options: { title: string; body: string }) => NotificationLike;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export interface PollResult {
  notified: number;
  errored: number;
}

export interface Notifier {
  /** Fetches pending desktop deliveries, shows a Notification for any not
   * already displayed this process lifetime, then acks each one (retried
   * even for already-seen ids, in case a prior ack attempt failed —
   * ack is idempotent server-side). */
  pollOnce(): Promise<PollResult>;
}

function buildTitle(d: PendingDesktopDelivery): string {
  return d.importance === "important" ? `${BELL_PREFIX}${d.taskTitle}` : d.taskTitle;
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const log = deps.log ?? (() => {});
  // Dedupe guard: fetchPending can return the same delivery on two polls in
  // a row if the previous ack failed to reach the server before the next
  // tick fired. Session-scoped (not persisted) — a restart is a fresh slate,
  // which is fine since the server only stops returning a delivery once the
  // ack actually lands.
  const seen = new Set<string>();

  function display(d: PendingDesktopDelivery): void {
    const title = buildTitle(d);
    if (!deps.isPackaged || !deps.isNotificationSupported()) {
      log("desktop notification (dev/unsupported fallback)", {
        title,
        taskId: d.taskId,
        deliveryId: d.id,
      });
      return;
    }
    const notification = deps.createNotification({
      title,
      body: "Open Calmly to see it.",
    });
    notification.on("click", () => {
      const win = deps.getMainWindow();
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send(OPEN_TASK_CHANNEL, { taskId: d.taskId });
    });
    notification.show();
  }

  return {
    async pollOnce() {
      let pending: PendingDesktopDelivery[];
      try {
        pending = await deps.client.fetchPending();
      } catch (err) {
        log("desktop reminder poll failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return { notified: 0, errored: 1 };
      }

      let notified = 0;
      let errored = 0;
      for (const d of pending) {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          display(d);
          notified++;
        }
        try {
          await deps.client.ack(d.id);
        } catch (err) {
          errored++;
          log("desktop reminder ack failed", {
            deliveryId: d.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { notified, errored };
    },
  };
}

export interface NotifierPollLoop {
  start(): void;
  stop(): void;
}

export function createNotifierPollLoop(
  notifier: Notifier,
  opts: {
    intervalMs?: number;
    log?: (msg: string, fields?: Record<string, unknown>) => void;
  } = {},
): NotifierPollLoop {
  const intervalMs = opts.intervalMs ?? 30_000;
  const log = opts.log ?? (() => {});
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        notifier.pollOnce().catch((err: unknown) => {
          log("notifier poll threw", {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
