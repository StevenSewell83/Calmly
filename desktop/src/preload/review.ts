import { ipcRenderer } from "electron";
import type { ReviewBridge } from "./api-types";

export const reviewBridge: ReviewBridge = {
  summary() {
    return ipcRenderer.invoke("review:summary") as ReturnType<ReviewBridge["summary"]>;
  },
  carryForward(taskIds) {
    return ipcRenderer.invoke("review:carryForward", { taskIds }) as ReturnType<ReviewBridge["carryForward"]>;
  },
  drop(taskIds) {
    return ipcRenderer.invoke("review:drop", { taskIds }) as ReturnType<ReviewBridge["drop"]>;
  },
  markDone(taskIds) {
    return ipcRenderer.invoke("review:markDone", { taskIds }) as ReturnType<ReviewBridge["markDone"]>;
  },
  moveTo(taskId, targetDayMs) {
    return ipcRenderer.invoke("review:moveTo", { taskId, targetDayMs }) as ReturnType<ReviewBridge["moveTo"]>;
  },
  saveReflection(text) {
    return ipcRenderer.invoke("review:saveReflection", { text }) as ReturnType<ReviewBridge["saveReflection"]>;
  },
  completeShutdown(text) {
    return ipcRenderer.invoke("review:completeShutdown", { text }) as ReturnType<ReviewBridge["completeShutdown"]>;
  },
};
