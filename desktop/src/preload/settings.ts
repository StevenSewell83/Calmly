import { ipcRenderer } from "electron";
import type { SettingsBridge } from "./api-types";

export const settingsBridge: SettingsBridge = {
  getSyncServerUrl(): Promise<string> {
    return ipcRenderer.invoke("settings:getSyncServerUrl") as Promise<string>;
  },
  setSyncServerUrl(url: string): Promise<void> {
    return ipcRenderer.invoke(
      "settings:setSyncServerUrl",
      url,
    ) as Promise<void>;
  },
  clearSyncServerUrl(): Promise<void> {
    return ipcRenderer.invoke("settings:clearSyncServerUrl") as Promise<void>;
  },
  reindexSearch(): Promise<void> {
    return ipcRenderer.invoke("settings:reindexSearch") as Promise<void>;
  },
};
