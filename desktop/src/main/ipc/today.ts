import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import {
  countUnresolvedInbox,
  listTodayEvents,
  listTodayTasks,
  type EventTodayRow,
  type TaskTodayRow,
} from "../today/store";

let registered = false;

export type ListTodayTasksResult =
  | { ok: true; tasks: TaskTodayRow[] }
  | { ok: false; error: "NotSignedIn" };

export type ListTodayEventsResult =
  | { ok: true; events: EventTodayRow[] }
  | { ok: false; error: "NotSignedIn" };

export type UnresolvedInboxCountResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" };

export function registerTodayIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("tasks:listToday", (): ListTodayTasksResult => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    // Pull the local TZ offset from the OS at fetch time. Once the
    // settings UI ships (Epic 9) this will read user_settings.timezone
    // and pass an explicit offset for cross-device consistency.
    const now = Date.now();
    const tz = new Date().getTimezoneOffset();
    return {
      ok: true,
      tasks: listTodayTasks(getDb(), user.id, now, tz),
    };
  });

  ipcMain.handle("events:listToday", (): ListTodayEventsResult => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    const now = Date.now();
    const tz = new Date().getTimezoneOffset();
    return {
      ok: true,
      events: listTodayEvents(getDb(), user.id, now, tz),
    };
  });

  ipcMain.handle("inbox:unresolvedCount", (): UnresolvedInboxCountResult => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    return {
      ok: true,
      count: countUnresolvedInbox(getDb(), user.id, Date.now()),
    };
  });
}
