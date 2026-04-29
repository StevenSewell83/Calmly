import { ipcRenderer } from "electron";
import type {
  EventsBridge,
  ListTodayEventsResult,
  ListTodayTasksResult,
  TasksBridge,
} from "./api-types";

// Read-side bridges that drive the Home screen. Each handler is a thin
// proxy over an ipcRenderer.invoke; the row shapes themselves live in
// main/today/store.ts. inbox.unresolvedCount lives on the existing
// InboxBridge — see ./inbox.ts.

export const tasksBridge: TasksBridge = {
  listToday(): Promise<ListTodayTasksResult> {
    return ipcRenderer.invoke("tasks:listToday") as Promise<
      ListTodayTasksResult
    >;
  },
};

export const eventsBridge: EventsBridge = {
  listToday(): Promise<ListTodayEventsResult> {
    return ipcRenderer.invoke("events:listToday") as Promise<
      ListTodayEventsResult
    >;
  },
};
