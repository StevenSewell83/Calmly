import { ipcRenderer } from "electron";
import type { LogBridge } from "./api-types";

export const logBridge: LogBridge = {
  event(name: string, props?: Record<string, unknown>): void {
    void ipcRenderer.invoke("log:event", name, props);
  },
};
