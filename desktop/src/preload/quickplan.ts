import { ipcRenderer } from "electron";
import type { QuickPlanBridge } from "./api-types";

export const quickplanBridge: QuickPlanBridge = {
  getDate() {
    return ipcRenderer.invoke("quickplan:getDate") as ReturnType<QuickPlanBridge["getDate"]>;
  },
  setDate(date: string) {
    return ipcRenderer.invoke("quickplan:setDate", date) as ReturnType<QuickPlanBridge["setDate"]>;
  },
};
