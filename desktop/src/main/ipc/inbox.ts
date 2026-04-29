import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import {
  addInboxItem,
  listInbox,
  skipInboxItem,
  snoozeInboxItem,
  type AddInboxItemResult,
  type InboxListRow,
  type SkipInboxResult,
  type SnoozeInboxResult,
} from "../inbox/store";

let registered = false;

export type InboxAddResult =
  | AddInboxItemResult
  | { ok: false; error: "NotSignedIn" };

export type InboxListResult =
  | { ok: true; items: InboxListRow[] }
  | { ok: false; error: "NotSignedIn" };

export type InboxSnoozeResult =
  | SnoozeInboxResult
  | { ok: false; error: "NotSignedIn" };

export type InboxSkipResult =
  | SkipInboxResult
  | { ok: false; error: "NotSignedIn" };

export function registerInboxIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "inbox:add",
    async (_e, rawText: unknown): Promise<InboxAddResult> => {
      // Source is hardcoded server-side: the renderer can only originate
      // 'desktop' captures. Telegram captures hit a separate ingestion path.
      if (typeof rawText !== "string") {
        return { ok: false, error: "EmptyInput" };
      }
      const user = getCurrentUser();
      if (!user) {
        // Should be unreachable when AuthGate is doing its job, but the IPC
        // boundary is the right place to fail closed regardless.
        return { ok: false, error: "NotSignedIn" };
      }
      return addInboxItem({
        db: getDb(),
        userId: user.id,
        rawText,
        source: "desktop",
      });
    },
  );

  ipcMain.handle("inbox:list", async (): Promise<InboxListResult> => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    return {
      ok: true,
      items: listInbox(getDb(), user.id, Date.now()),
    };
  });

  ipcMain.handle(
    "inbox:snooze",
    async (
      _e,
      id: unknown,
      untilMs: unknown,
    ): Promise<InboxSnoozeResult> => {
      if (typeof id !== "string" || typeof untilMs !== "number") {
        return { ok: false, error: "InvalidUntil" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return snoozeInboxItem(getDb(), user.id, id, untilMs, Date.now());
    },
  );

  ipcMain.handle(
    "inbox:skip",
    async (_e, id: unknown): Promise<InboxSkipResult> => {
      if (typeof id !== "string") {
        return { ok: false, error: "NotFound" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return skipInboxItem(getDb(), user.id, id, Date.now());
    },
  );
}
