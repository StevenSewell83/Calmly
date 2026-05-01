// POL-03: IPC handlers for crash reporting settings.
import { ipcMain } from "electron";
import { getCrashStatus, setCrashEnabled } from "../crash";

let registered = false;

export function registerCrashIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("crash:getStatus", () => getCrashStatus());

  ipcMain.handle("crash:setEnabled", (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") return;
    setCrashEnabled(enabled);
  });
}
