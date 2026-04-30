import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import {
  listForDay,
  scheduleTask,
  unscheduleTask,
  updateTask,
  type PlanForDay,
  type ScheduleResult,
  type UnscheduleResult,
  type UpdateTaskResult,
  type UpdateTaskArgs,
} from "../plan/store";

let registered = false;

export type PlanListResult =
  | { ok: true; plan: PlanForDay; day: number }
  | { ok: false; error: "NotSignedIn" };

export type PlanScheduleResult =
  | ScheduleResult
  | { ok: false; error: "NotSignedIn" };

export type PlanUnscheduleResult =
  | UnscheduleResult
  | { ok: false; error: "NotSignedIn" };

export type PlanUpdateResult =
  | UpdateTaskResult
  | { ok: false; error: "NotSignedIn" };

interface ListInvoke {
  // Caller-supplied day anchor (any unix-ms inside the desired local
  // day). NULL/undefined = today.
  day?: unknown;
}

interface ScheduleInvoke {
  taskId: unknown;
  startAt: unknown;
  endAt: unknown;
}

interface UpdateInvoke {
  taskId: unknown;
  title?: unknown;
  notes?: unknown;
  dueAt?: unknown;
  scheduledStart?: unknown;
  scheduledEnd?: unknown;
}

function isStringId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function registerPlanIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "plan:listForDay",
    async (_e, payload: ListInvoke): Promise<PlanListResult> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      const day =
        payload && typeof payload.day === "number" && Number.isFinite(payload.day)
          ? payload.day
          : Date.now();
      const tz = new Date().getTimezoneOffset();
      return {
        ok: true,
        plan: listForDay(getDb(), user.id, day, tz),
        day,
      };
    },
  );

  ipcMain.handle(
    "plan:schedule",
    async (_e, payload: ScheduleInvoke): Promise<PlanScheduleResult> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "InvalidArgs" };
      }
      if (
        !isStringId(payload.taskId) ||
        typeof payload.startAt !== "number" ||
        typeof payload.endAt !== "number"
      ) {
        return { ok: false, error: "InvalidArgs" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return scheduleTask(
        getDb(),
        user.id,
        payload.taskId,
        payload.startAt,
        payload.endAt,
        Date.now(),
      );
    },
  );

  ipcMain.handle(
    "plan:unschedule",
    async (_e, taskId: unknown): Promise<PlanUnscheduleResult> => {
      if (!isStringId(taskId)) return { ok: false, error: "NotFound" };
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return unscheduleTask(getDb(), user.id, taskId, Date.now());
    },
  );

  ipcMain.handle(
    "plan:update",
    async (_e, payload: UpdateInvoke): Promise<PlanUpdateResult> => {
      if (!payload || typeof payload !== "object") return { ok: false, error: "InvalidArgs" };
      if (!isStringId(payload.taskId)) return { ok: false, error: "InvalidArgs" };
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };

      const args: UpdateTaskArgs = {};
      if (payload.title !== undefined) {
        if (typeof payload.title !== "string") return { ok: false, error: "InvalidArgs" };
        args.title = payload.title;
      }
      if (payload.notes !== undefined) {
        if (payload.notes !== null && typeof payload.notes !== "string") return { ok: false, error: "InvalidArgs" };
        args.notes = payload.notes as string | null;
      }
      if (payload.dueAt !== undefined) {
        if (payload.dueAt !== null && typeof payload.dueAt !== "number") return { ok: false, error: "InvalidArgs" };
        args.dueAt = payload.dueAt as number | null;
      }
      if (payload.scheduledStart !== undefined) {
        if (payload.scheduledStart !== null && typeof payload.scheduledStart !== "number") return { ok: false, error: "InvalidArgs" };
        args.scheduledStart = payload.scheduledStart as number | null;
      }
      if (payload.scheduledEnd !== undefined) {
        if (payload.scheduledEnd !== null && typeof payload.scheduledEnd !== "number") return { ok: false, error: "InvalidArgs" };
        args.scheduledEnd = payload.scheduledEnd as number | null;
      }
      return updateTask(getDb(), user.id, payload.taskId, args, Date.now());
    },
  );
}
