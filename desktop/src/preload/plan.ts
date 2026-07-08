import { ipcRenderer } from "electron";
import type {
  PlanBridge,
  PlanListResult,
  PlanScheduleArgs,
  PlanScheduleResult,
  PlanUnscheduleResult,
  PlanUpdateArgs,
  PlanUpdateResult,
  PlanMoveToDateArgs,
  PlanMoveToDateResult,
  PlanPushByArgs,
  PlanPushByResult,
  PlanDropResult,
} from "./api-types";

export const planBridge: PlanBridge = {
  listForDay(day?: number): Promise<PlanListResult> {
    return ipcRenderer.invoke("plan:listForDay", {
      day,
    }) as Promise<PlanListResult>;
  },
  schedule(args: PlanScheduleArgs): Promise<PlanScheduleResult> {
    return ipcRenderer.invoke(
      "plan:schedule",
      args,
    ) as Promise<PlanScheduleResult>;
  },
  unschedule(taskId: string): Promise<PlanUnscheduleResult> {
    return ipcRenderer.invoke(
      "plan:unschedule",
      taskId,
    ) as Promise<PlanUnscheduleResult>;
  },
  update(args: PlanUpdateArgs): Promise<PlanUpdateResult> {
    return ipcRenderer.invoke("plan:update", args) as Promise<PlanUpdateResult>;
  },
  moveToDate(args: PlanMoveToDateArgs): Promise<PlanMoveToDateResult> {
    return ipcRenderer.invoke(
      "plan:moveToDate",
      args,
    ) as Promise<PlanMoveToDateResult>;
  },
  pushBy(args: PlanPushByArgs): Promise<PlanPushByResult> {
    return ipcRenderer.invoke("plan:pushBy", args) as Promise<PlanPushByResult>;
  },
  toBacklog(taskId: string): Promise<PlanUnscheduleResult> {
    return ipcRenderer.invoke(
      "plan:toBacklog",
      taskId,
    ) as Promise<PlanUnscheduleResult>;
  },
  dropFromToday(taskId: string): Promise<PlanDropResult> {
    return ipcRenderer.invoke(
      "plan:dropFromToday",
      taskId,
    ) as Promise<PlanDropResult>;
  },
};
