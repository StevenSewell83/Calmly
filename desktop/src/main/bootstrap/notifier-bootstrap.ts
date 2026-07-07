import { Notification } from "electron";
import type { BrowserWindow } from "electron";
import type { ApiClient } from "../net/client";
import { createDesktopDeliveriesClient } from "../reminders/deliveriesClient";
import {
  createNotifier,
  createNotifierPollLoop,
  type NotifierPollLoop,
  type WindowLike,
} from "../reminders/notifier";

export function createNotifierBootstrap(opts: {
  apiClient: ApiClient;
  getMainWindow: () => BrowserWindow | null;
  isPackaged: boolean;
  intervalMs?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}): NotifierPollLoop {
  const notifier = createNotifier({
    client: createDesktopDeliveriesClient(opts.apiClient),
    getMainWindow: () => opts.getMainWindow() as WindowLike | null,
    isPackaged: opts.isPackaged,
    isNotificationSupported: () => Notification.isSupported(),
    createNotification: (options) => new Notification(options),
    log: opts.log,
  });
  return createNotifierPollLoop(notifier, {
    intervalMs: opts.intervalMs,
    log: opts.log,
  });
}
