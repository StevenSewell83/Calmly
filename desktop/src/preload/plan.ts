import { ipcRenderer } from "electron";
import type {
  PlanBridge,
  PlanListResult,
  PlanScheduleArgs,
  PlanScheduleResult,
  PlanUnscheduleResult,
  PlanUpdateArgs,
  PlanUpdateResult,
} from "./api-types";

export const planBridge: PlanBridge = {
  listForDay(day?: number): Promise<PlanListResult> {
    return ipcRenderer.invoke("plan:listForDay", { day }) as Promise<PlanListResult>;
  },
  schedule(args: PlanScheduleArgs): Promise<PlanScheduleResult> {
    return ipcRenderer.invoke("plan:schedule", args) as Promise<PlanScheduleResult>;
  },
  unschedule(taskId: string): Promise<PlanUnscheduleResult> {
    return ipcRenderer.invoke("plan:unschedule", taskId) as Promise<PlanUnscheduleResult>;
  },
  update(args: PlanUpdateArgs): Promise<PlanUpdateResult> {
    return ipcRenderer.invoke("plan:update", args) as Promise<PlanUpdateResult>;
  },
};
