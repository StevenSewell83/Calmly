import { BrowserWindow, ipcMain } from "electron";
import {
  deleteLocalCalendarAccount,
  getLocalCalendarAccount,
  listLocalCalendarAccounts,
} from "../calendar/localStore";
import { calendarTokens } from "../calendar/tokens";
import { calendarStatusEvents } from "../calendar/statusEvents";
import { triggerImport } from "../calendar/importWorker";
import { listCalendarEvents } from "../calendar/eventStore";
import { getDb } from "../db";
import type { CalendarDayEvent } from "../../preload/api-types";
import type { ApiClient } from "../net/client";
import { ApiHttpError } from "../net/client";
import { getCurrentUser } from "../auth/currentUser";
import type {
  CalendarAccount,
  CalendarAccountStatus,
  CalendarConnectResult,
  CalendarProvider,
} from "@calmly/shared";

export type ListCalendarAccountsResult =
  | { ok: true; accounts: CalendarAccount[] }
  | { ok: false; error: "NotSignedIn" };

export type DisconnectCalendarResult =
  | { ok: true }
  | {
      ok: false;
      error: "NotSignedIn" | "NotFound" | "InvalidArgs" | "InternalError";
    };

const STATUS_CHANNEL = "calendar:account-status-changed";

let registered = false;
let unsubscribeStatus: (() => void) | null = null;

export interface CalendarIpcDeps {
  apiClient: ApiClient;
  connectGoogle: () => Promise<CalendarConnectResult>;
  connectMicrosoft: () => Promise<CalendarConnectResult>;
}

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  if (registered) return;
  registered = true;

  // Bridge in-process status events to every BrowserWindow. The renderer
  // subscribes via `onAccountStatusChanged`.
  unsubscribeStatus = calendarStatusEvents.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(STATUS_CHANNEL, event);
    }
  });

  ipcMain.handle(
    "calendar:connectGoogle",
    async (): Promise<CalendarConnectResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "not_signed_in" };
      return deps.connectGoogle();
    },
  );

  ipcMain.handle(
    "calendar:connectMicrosoft",
    async (): Promise<CalendarConnectResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "not_signed_in" };
      return deps.connectMicrosoft();
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

  ipcMain.handle(
    "calendar:disconnect",
    async (_e, accountId: unknown): Promise<DisconnectCalendarResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (typeof accountId !== "string" || accountId.length === 0) {
        return { ok: false, error: "InvalidArgs" };
      }

      const account = getLocalCalendarAccount(accountId);
      if (!account) return { ok: false, error: "NotFound" };

      // Server delete is best-effort: a 401/timeout shouldn't strand the
      // local row. Non-2xx other than 401 is treated as fatal so the user
      // sees the failure rather than a phantom-disconnected account.
      try {
        await deps.apiClient.request(
          "POST",
          `/oauth/${account.provider as CalendarProvider}/disconnect`,
          { account_id: accountId },
        );
      } catch (err) {
        if (err instanceof ApiHttpError && err.status !== 401) {
          return { ok: false, error: "InternalError" };
        }
        // 401 / network: fall through and clean up locally so the user can
        // retry the OAuth flow without a stale entry blocking them.
      }

      try {
        calendarTokens.delete(account.provider, accountId);
      } catch {
        // Secret store unavailable; the row delete still proceeds. The next
        // refresh attempt would error anyway.
      }
      const removed = deleteLocalCalendarAccount(accountId);
      if (!removed) return { ok: false, error: "NotFound" };

      const disconnected: CalendarAccountStatus = "disconnected";
      calendarStatusEvents.notify({ accountId, status: disconnected });
      return { ok: true };
    },
  );

  ipcMain.handle(
    "calendar:listEventsForDay",
    async (
      _e,
      dayIso: unknown,
    ): Promise<
      | { ok: true; events: CalendarDayEvent[] }
      | { ok: false; error: "NotSignedIn" | "InvalidArgs" }
    > => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (typeof dayIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dayIso)) {
        return { ok: false, error: "InvalidArgs" };
      }
      const fromMs = new Date(`${dayIso}T00:00:00`).getTime();
      const toMs = fromMs + 24 * 60 * 60 * 1000;
      const rows = listCalendarEvents(getDb(), user.id, fromMs, toMs);
      const events: CalendarDayEvent[] = rows.map((row) => {
        const raw = JSON.parse(row.raw_json) as Record<string, unknown>;
        const title =
          (row.provider === "google"
            ? (raw["summary"] as string | undefined)
            : (raw["subject"] as string | undefined)) ?? "(No title)";
        const loc =
          row.provider === "google"
            ? (raw["location"] as string | undefined)
            : (raw["location"] as { displayName?: string } | undefined)
                ?.displayName;
        const isAllDay =
          row.provider === "google"
            ? !!(raw["start"] as { date?: string } | undefined)?.date
            : !!(raw["isAllDay"] as boolean | undefined);
        return {
          id: row.id,
          provider: row.provider,
          title,
          startMs: row.start_at,
          endMs: row.end_at,
          isAllDay,
          location: loc,
        };
      });
      return { ok: true, events };
    },
  );

  ipcMain.handle(
    "calendar:refresh",
    async (_e, accountId: unknown): Promise<{ ok: boolean }> => {
      const user = getCurrentUser();
      if (!user) return { ok: false };
      const id =
        typeof accountId === "string" && accountId.length > 0
          ? accountId
          : undefined;
      await triggerImport(id);
      return { ok: true };
    },
  );
}

// Test helper — the IPC singleton resets cleanly between specs.
export function __resetCalendarIpcForTests(): void {
  registered = false;
  unsubscribeStatus?.();
  unsubscribeStatus = null;
}
