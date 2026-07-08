import { ipcRenderer } from "electron";
import type {
  TriageBridge,
  TriageBreakdownResult,
  TriageDiscardResult,
  TriageResolveAsEventArgs,
  TriageResolveAsTaskArgs,
  TriageResolveEventResult,
  TriageResolveTaskResult,
  TriageResolveWithBreakdownArgs,
} from "./api-types";

export const triageBridge: TriageBridge = {
  resolveAsTask(
    args: TriageResolveAsTaskArgs,
  ): Promise<TriageResolveTaskResult> {
    return ipcRenderer.invoke(
      "triage:resolveAsTask",
      args,
    ) as Promise<TriageResolveTaskResult>;
  },
  resolveAsEvent(
    args: TriageResolveAsEventArgs,
  ): Promise<TriageResolveEventResult> {
    return ipcRenderer.invoke(
      "triage:resolveAsEvent",
      args,
    ) as Promise<TriageResolveEventResult>;
  },
  discard(inboxId: string): Promise<TriageDiscardResult> {
    return ipcRenderer.invoke(
      "triage:discard",
      inboxId,
    ) as Promise<TriageDiscardResult>;
  },
  resolveWithBreakdown(
    args: TriageResolveWithBreakdownArgs,
  ): Promise<TriageBreakdownResult> {
    return ipcRenderer.invoke(
      "triage:resolveWithBreakdown",
      args,
    ) as Promise<TriageBreakdownResult>;
  },
};
