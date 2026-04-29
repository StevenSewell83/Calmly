import { ipcMain } from "electron";
import type { Logger } from "@calmly/shared";

let registered = false;

// Narrow IPC surface: the renderer can only send EVENTS, not raw log calls.
// Log levels and messages stay owned by the main process so the renderer can't
// flood the log file with high-frequency lines.
export function registerLogIpc(logger: Logger): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "log:event",
    (_e, name: unknown, props: unknown): { ok: true } => {
      if (typeof name !== "string" || name.length === 0 || name.length > 64) {
        return { ok: true };
      }
      const propsObj =
        typeof props === "object" && props !== null && !Array.isArray(props)
          ? (props as Record<string, unknown>)
          : undefined;
      logger.event(name, propsObj);
      return { ok: true };
    },
  );
}
