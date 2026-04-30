import { ipcRenderer } from "electron";

const ADHOC_FOCUS_CHANNEL = "focus:adhoc-open";
import type {
  FocusBridge,
  FocusCurrentResult,
  FocusEndResult,
  FocusMarkDoneResult,
  FocusSearchResult,
  FocusStartAdHocResult,
  FocusStartArgs,
  FocusStartResult,
  FocusSwitchResult,
} from "./api-types";

export const focusBridge: FocusBridge = {
  current(): Promise<FocusCurrentResult> {
    return ipcRenderer.invoke("focus:current") as Promise<FocusCurrentResult>;
  },
  start(args: FocusStartArgs): Promise<FocusStartResult> {
    return ipcRenderer.invoke("focus:start", args) as Promise<FocusStartResult>;
  },
  end(): Promise<FocusEndResult> {
    return ipcRenderer.invoke("focus:end") as Promise<FocusEndResult>;
  },
  markDone(): Promise<FocusMarkDoneResult> {
    return ipcRenderer.invoke("focus:markDone") as Promise<FocusMarkDoneResult>;
  },
  switch(args: FocusStartArgs): Promise<FocusSwitchResult> {
    return ipcRenderer.invoke("focus:switch", args) as Promise<FocusSwitchResult>;
  },
  searchOpenTasks(query: string): Promise<FocusSearchResult> {
    return ipcRenderer.invoke("focus:searchOpenTasks", query) as Promise<FocusSearchResult>;
  },
  startAdHoc(title: string): Promise<FocusStartAdHocResult> {
    return ipcRenderer.invoke("focus:startAdHoc", title) as Promise<FocusStartAdHocResult>;
  },
  onAdHocRequest(handler: () => void): () => void {
    const wrapped = (): void => handler();
    ipcRenderer.on(ADHOC_FOCUS_CHANNEL, wrapped);
    return () => { ipcRenderer.off(ADHOC_FOCUS_CHANNEL, wrapped); };
  },
};
