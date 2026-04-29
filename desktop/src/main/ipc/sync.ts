import { ipcMain } from "electron";
import { getDb } from "../db";
import { queueSize } from "../sync/queue";
import { getSyncState } from "../sync/state";
import type { SyncLoop, SyncResult } from "../sync/loop";

export interface SyncStatus {
  queueSize: number;
  lastPulledVersion: number;
  lastPushedAt: number | null;
}

let registered = false;

export function registerSyncIpc(loop: SyncLoop): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("sync:status", (): SyncStatus => {
    const db = getDb();
    const state = getSyncState(db);
    return {
      queueSize: queueSize(db),
      lastPulledVersion: state.last_pulled_version,
      lastPushedAt: state.last_pushed_at,
    };
  });

  ipcMain.handle("sync:now", async (): Promise<SyncResult> => loop.syncNow());
}
