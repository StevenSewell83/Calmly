import { ipcRenderer } from "electron";
import type { ReplanBridge, ReplanAction, ReplanReason } from "./api-types";

export const replanBridge: ReplanBridge = {
  recordEvent(reason: ReplanReason) {
    return ipcRenderer.invoke("replan:recordEvent", { reason }) as ReturnType<ReplanBridge["recordEvent"]>;
  },
  applyBatch(actions: ReplanAction[]) {
    return ipcRenderer.invoke("replan:applyBatch", actions) as ReturnType<ReplanBridge["applyBatch"]>;
  },
};
