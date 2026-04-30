import { ipcRenderer } from "electron";
import type {
  PlanBridge,
  PlanListResult,
  PlanScheduleArgs,
  PlanScheduleResult,
  PlanUnscheduleResult,
} from "./api-types";

export const planBridge: PlanBridge = {
  listForDay(day?: number): Promise<PlanListResult> {
    return ipcRenderer.invoke("plan:listForDay", { day }) as Promise<
      PlanListResult
    >;
  },
  schedule(args: PlanScheduleArgs): Promise<PlanScheduleResult> {
    return ipcRenderer.invoke("plan:schedule", args) as Promise<
      PlanScheduleResult
    >;
  },
  unschedule(taskId: string): Promise<PlanUnscheduleResult> {
    return ipcRenderer.invoke("plan:unschedule", taskId) as Promise<
      PlanUnscheduleResult
    >;
  },
};
