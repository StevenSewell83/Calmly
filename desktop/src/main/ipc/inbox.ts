import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import { addInboxItem, type AddInboxItemResult } from "../inbox/store";

let registered = false;

export type InboxAddResult =
  | AddInboxItemResult
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
}
