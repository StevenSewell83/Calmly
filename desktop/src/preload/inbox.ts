import { ipcRenderer } from "electron";
import type {
  InboxAddResult,
  InboxBridge,
  InboxListResult,
  InboxSkipResult,
  InboxSnoozeResult,
  UnresolvedInboxCountResult,
} from "./api-types";

const FOCUS_CHANNEL = "capture:focus";

export const inboxBridge: InboxBridge = {
  add(rawText: string): Promise<InboxAddResult> {
    return ipcRenderer.invoke("inbox:add", rawText) as Promise<InboxAddResult>;
  },
  list(): Promise<InboxListResult> {
    return ipcRenderer.invoke("inbox:list") as Promise<InboxListResult>;
  },
  snooze(id: string, untilMs: number): Promise<InboxSnoozeResult> {
    return ipcRenderer.invoke("inbox:snooze", id, untilMs) as Promise<
      InboxSnoozeResult
    >;
  },
  skip(id: string): Promise<InboxSkipResult> {
    return ipcRenderer.invoke("inbox:skip", id) as Promise<InboxSkipResult>;
  },
  unresolvedCount(): Promise<UnresolvedInboxCountResult> {
    return ipcRenderer.invoke("inbox:unresolvedCount") as Promise<
      UnresolvedInboxCountResult
    >;
  },
  onFocusRequest(handler: () => void): () => void {
    const wrapped = (): void => handler();
    ipcRenderer.on(FOCUS_CHANNEL, wrapped);
    return () => {
      ipcRenderer.off(FOCUS_CHANNEL, wrapped);
    };
  },
};
