import { ipcRenderer } from "electron";
import type { UpdateStatus } from "@calmly/shared";
import type { UpdatesBridge } from "./api-types";

const STATUS_CHANNEL = "updates:status-changed";

export const updatesBridge: UpdatesBridge = {
  getStatus(): Promise<UpdateStatus> {
    return ipcRenderer.invoke("updates:getStatus") as Promise<UpdateStatus>;
  },
  check(): Promise<UpdateStatus> {
    return ipcRenderer.invoke("updates:check") as Promise<UpdateStatus>;
  },
  download(): Promise<UpdateStatus> {
    return ipcRenderer.invoke("updates:download") as Promise<UpdateStatus>;
  },
  quitAndInstall(): Promise<UpdateStatus> {
    return ipcRenderer.invoke("updates:quitAndInstall") as Promise<UpdateStatus>;
  },
  onStatusChanged(handler: (status: UpdateStatus) => void): () => void {
    const wrapped = (_e: unknown, status: UpdateStatus) => handler(status);
    ipcRenderer.on(STATUS_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(STATUS_CHANNEL, wrapped);
    };
  },
};
