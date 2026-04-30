import { ipcRenderer } from "electron";
import type {
  TriageBridge,
  TriageDiscardResult,
  TriageResolveAsEventArgs,
  TriageResolveAsTaskArgs,
  TriageResolveEventResult,
  TriageResolveTaskResult,
} from "./api-types";

export const triageBridge: TriageBridge = {
  resolveAsTask(args: TriageResolveAsTaskArgs): Promise<TriageResolveTaskResult> {
    return ipcRenderer.invoke("triage:resolveAsTask", args) as Promise<
      TriageResolveTaskResult
    >;
  },
  resolveAsEvent(
    args: TriageResolveAsEventArgs,
  ): Promise<TriageResolveEventResult> {
    return ipcRenderer.invoke("triage:resolveAsEvent", args) as Promise<
      TriageResolveEventResult
    >;
  },
  discard(inboxId: string): Promise<TriageDiscardResult> {
    return ipcRenderer.invoke("triage:discard", inboxId) as Promise<
      TriageDiscardResult
    >;
  },
};
