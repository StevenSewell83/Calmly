import { ipcRenderer } from "electron";
import type { InboxAddResult, InboxBridge } from "./api-types";

const FOCUS_CHANNEL = "capture:focus";

export const inboxBridge: InboxBridge = {
  add(rawText: string): Promise<InboxAddResult> {
    return ipcRenderer.invoke("inbox:add", rawText) as Promise<InboxAddResult>;
  },
  onFocusRequest(handler: () => void): () => void {
    const wrapped = (): void => handler();
    ipcRenderer.on(FOCUS_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(FOCUS_CHANNEL, wrapped);
    };
  },
};
