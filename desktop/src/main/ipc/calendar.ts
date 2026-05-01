import { ipcMain } from "electron";
import { listLocalCalendarAccounts } from "../calendar/localStore";
import { getCurrentUser } from "../auth/currentUser";
import type { CalendarAccount, CalendarConnectResult } from "@calmly/shared";

export type ListCalendarAccountsResult =
  | { ok: true; accounts: CalendarAccount[] }
  | { ok: false; error: "NotSignedIn" };

let registered = false;

export interface CalendarIpcDeps {
  connectGoogle: () => Promise<CalendarConnectResult>;
}

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "calendar:connectGoogle",
    async (): Promise<CalendarConnectResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "not_signed_in" };
      return deps.connectGoogle();
    },
  );

  ipcMain.handle(
    "calendar:listAccounts",
    async (): Promise<ListCalendarAccountsResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return { ok: true, accounts: listLocalCalendarAccounts() };
    },
  );
}
