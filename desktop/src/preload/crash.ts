import { ipcRenderer } from "electron";
import type { CrashBridge } from "./api-types";

export const crashBridge: CrashBridge = {
  getStatus() {
    return ipcRenderer.invoke("crash:getStatus") as ReturnType<
      CrashBridge["getStatus"]
    >;
  },
  setEnabled(enabled: boolean) {
    return ipcRenderer.invoke("crash:setEnabled", enabled) as ReturnType<
      CrashBridge["setEnabled"]
    >;
  },
};
