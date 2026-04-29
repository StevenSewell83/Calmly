import { ipcRenderer } from "electron";
import type { DbBridge, DbHealth } from "./api-types";

export const dbBridge: DbBridge = {
  health(): Promise<DbHealth> {
    return ipcRenderer.invoke("db:health") as Promise<DbHealth>;
  },
};
