import { ipcRenderer } from "electron";
import type { CalendarBridge, ListCalendarAccountsResult } from "./api-types";
import type { CalendarConnectResult } from "@calmly/shared";

export const calendarBridge: CalendarBridge = {
  connectGoogle(): Promise<CalendarConnectResult> {
    return ipcRenderer.invoke("calendar:connectGoogle") as Promise<CalendarConnectResult>;
  },
  listAccounts(): Promise<ListCalendarAccountsResult> {
    return ipcRenderer.invoke("calendar:listAccounts") as Promise<ListCalendarAccountsResult>;
  },
};
