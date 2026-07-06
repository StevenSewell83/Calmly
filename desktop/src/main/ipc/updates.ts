// REL-06: IPC surface for the auto-update service. No auth gate — update
// availability isn't user data, and the check must work before/without a
// signed-in session. Status changes are rebroadcast to every BrowserWindow
// on a push channel so the (future) Settings UI doesn't have to poll.
import { BrowserWindow, ipcMain } from "electron";
import type { UpdateStatus } from "@calmly/shared";
import type { UpdateService } from "../updates/updateService";

const STATUS_CHANNEL = "updates:status-changed";

let registered = false;
let unsubscribeStatus: (() => void) | null = null;

export function registerUpdatesIpc(updateService: UpdateService): void {
  if (registered) return;
  registered = true;

  unsubscribeStatus = updateService.subscribe((status: UpdateStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(STATUS_CHANNEL, status);
    }
  });

  ipcMain.handle("updates:getStatus", (): UpdateStatus => updateService.getStatus());
  ipcMain.handle("updates:check", async (): Promise<UpdateStatus> => updateService.check());
  ipcMain.handle("updates:download", async (): Promise<UpdateStatus> => updateService.download());
  ipcMain.handle("updates:quitAndInstall", (): UpdateStatus => updateService.quitAndInstall());
}

// Test helper — the IPC singleton resets cleanly between specs.
export function __resetUpdatesIpcForTests(): void {
  registered = false;
  unsubscribeStatus?.();
  unsubscribeStatus = null;
}
