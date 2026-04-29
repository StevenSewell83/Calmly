import { ipcRenderer } from "electron";
import type { SyncBridge, SyncResult, SyncStatus } from "./api-types";

export const syncBridge: SyncBridge = {
  status(): Promise<SyncStatus> {
    return ipcRenderer.invoke("sync:status") as Promise<SyncStatus>;
  },
  syncNow(): Promise<SyncResult> {
    return ipcRenderer.invoke("sync:now") as Promise<SyncResult>;
  },
};
