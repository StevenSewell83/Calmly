import { ipcRenderer } from "electron";
import type {
  AccountStatusEventPayload,
  CalendarBridge,
  DisconnectCalendarResult,
  ListCalendarAccountsResult,
} from "./api-types";
import type { CalendarConnectResult } from "@calmly/shared";

const STATUS_CHANNEL = "calendar:account-status-changed";

export const calendarBridge: CalendarBridge = {
  connectGoogle(): Promise<CalendarConnectResult> {
    return ipcRenderer.invoke("calendar:connectGoogle") as Promise<CalendarConnectResult>;
  },
  connectMicrosoft(): Promise<CalendarConnectResult> {
    return ipcRenderer.invoke("calendar:connectMicrosoft") as Promise<CalendarConnectResult>;
  },
  listAccounts(): Promise<ListCalendarAccountsResult> {
    return ipcRenderer.invoke("calendar:listAccounts") as Promise<ListCalendarAccountsResult>;
  },
  disconnect(accountId: string): Promise<DisconnectCalendarResult> {
    return ipcRenderer.invoke(
      "calendar:disconnect",
      accountId,
    ) as Promise<DisconnectCalendarResult>;
  },
  onAccountStatusChanged(
    handler: (event: AccountStatusEventPayload) => void,
  ): () => void {
    const wrapped = (_e: unknown, payload: AccountStatusEventPayload) =>
      handler(payload);
    ipcRenderer.on(STATUS_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(STATUS_CHANNEL, wrapped);
    };
  },
};
