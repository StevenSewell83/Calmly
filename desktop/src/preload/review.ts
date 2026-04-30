import { ipcRenderer } from "electron";
import type {
  ReviewBridge,
  ReviewBulkArgs,
  ReviewBulkResult,
  ReviewCompleteShutdownArgs,
  ReviewCompleteShutdownResult,
  ReviewMoveToDateArgs,
  ReviewSaveReflectionArgs,
  ReviewSaveReflectionResult,
  ReviewSummaryResult,
} from "./api-types";

export const reviewBridge: ReviewBridge = {
  summary(): Promise<ReviewSummaryResult> {
    return ipcRenderer.invoke("review:summary") as Promise<ReviewSummaryResult>;
  },
  carryForward(args: ReviewBulkArgs): Promise<ReviewBulkResult> {
    return ipcRenderer.invoke(
      "review:carryForward",
      args,
    ) as Promise<ReviewBulkResult>;
  },
  drop(args: ReviewBulkArgs): Promise<ReviewBulkResult> {
    return ipcRenderer.invoke("review:drop", args) as Promise<ReviewBulkResult>;
  },
  markDone(args: ReviewBulkArgs): Promise<ReviewBulkResult> {
    return ipcRenderer.invoke(
      "review:markDone",
      args,
    ) as Promise<ReviewBulkResult>;
  },
  moveToDate(args: ReviewMoveToDateArgs): Promise<ReviewBulkResult> {
    return ipcRenderer.invoke(
      "review:moveToDate",
      args,
    ) as Promise<ReviewBulkResult>;
  },
  saveReflection(
    args: ReviewSaveReflectionArgs,
  ): Promise<ReviewSaveReflectionResult> {
    return ipcRenderer.invoke(
      "review:saveReflection",
      args,
    ) as Promise<ReviewSaveReflectionResult>;
  },
  completeShutdown(
    args: ReviewCompleteShutdownArgs,
  ): Promise<ReviewCompleteShutdownResult> {
    return ipcRenderer.invoke(
      "review:completeShutdown",
      args,
    ) as Promise<ReviewCompleteShutdownResult>;
  },
};
