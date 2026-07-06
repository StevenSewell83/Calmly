import { app, ipcMain } from "electron";
import { getDb } from "../db";
import {
  resolveServerUrl,
  saveServerUrl,
  clearServerUrl,
} from "../sync/serverConfig";
import { reindexSearch } from "../search/backfill";

export function registerSettingsIpc(): void {
  // No auth check: the version is not user data, and the settings screen
  // reads it before/regardless of sign-in state.
  ipcMain.handle("settings:getAppVersion", () => {
    return app.getVersion();
  });

  ipcMain.handle("settings:getSyncServerUrl", () => {
    return resolveServerUrl(getDb());
  });

  ipcMain.handle("settings:setSyncServerUrl", (_event, url: string) => {
    saveServerUrl(getDb(), url);
  });

  ipcMain.handle("settings:clearSyncServerUrl", () => {
    clearServerUrl(getDb());
  });

  ipcMain.handle("settings:reindexSearch", () => {
    reindexSearch(getDb(), console);
  });
}
