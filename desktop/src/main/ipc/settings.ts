import { ipcMain } from "electron";
import { getDb } from "../db";
import {
  resolveServerUrl,
  saveServerUrl,
  clearServerUrl,
} from "../sync/serverConfig";

export function registerSettingsIpc(): void {
  ipcMain.handle("settings:getSyncServerUrl", () => {
    return resolveServerUrl(getDb());
  });

  ipcMain.handle("settings:setSyncServerUrl", (_event, url: string) => {
    saveServerUrl(getDb(), url);
  });

  ipcMain.handle("settings:clearSyncServerUrl", () => {
    clearServerUrl(getDb());
  });
}
