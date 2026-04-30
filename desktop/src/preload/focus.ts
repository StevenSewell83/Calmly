import { ipcRenderer } from "electron";
import type {
  FocusBridge,
  FocusCurrentResult,
  FocusEndResult,
  FocusMarkDoneResult,
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
    return ipcRenderer.invoke("focus:switch", args) as Promise<
      FocusSwitchResult
    >;
  },
};
