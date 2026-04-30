import {
  listForDay,
  scheduleTask,
  unscheduleTask,
  updateTask,
  moveToDate,
  pushBy,
  dropFromToday,
  type PlanForDay,
  type ScheduleResult,
  type UnscheduleResult,
  type UpdateTaskResult,
  type UpdateTaskArgs,
  type MoveToDateResult,
  type PushByResult,
  type DropFromTodayResult,
} from "../plan/store";
import { authedHandler, isObject, isStringId } from "./handler";

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

export type PlanMoveToDateResult =
  | MoveToDateResult
  | { ok: false; error: "NotSignedIn" };

export type PlanPushByResult =
  | PushByResult
  | { ok: false; error: "NotSignedIn" };

export type PlanDropFromTodayResult =
  | DropFromTodayResult
  | { ok: false; error: "NotSignedIn" };

export function registerPlanIpc(): void {
  authedHandler<PlanListResult>("plan:listForDay", (ctx, raw) => {
    const day =
      isObject(raw) && typeof raw.day === "number" && Number.isFinite(raw.day)
        ? raw.day
        : ctx.now;
    return { ok: true, plan: listForDay(ctx.db, ctx.userId, day, ctx.tz), day };
  });

  authedHandler<PlanScheduleResult>("plan:schedule", (ctx, raw) => {
    if (
      !isObject(raw) ||
      !isStringId(raw.taskId) ||
      typeof raw.startAt !== "number" ||
      typeof raw.endAt !== "number"
    ) {
      return { ok: false, error: "InvalidArgs" };
    }
    return scheduleTask(ctx.db, ctx.userId, raw.taskId, raw.startAt as number, raw.endAt as number, ctx.now);
  });

  authedHandler<PlanUnscheduleResult>("plan:unschedule", (ctx, raw) => {
    if (!isStringId(raw)) return { ok: false, error: "InvalidArgs" };
    return unscheduleTask(ctx.db, ctx.userId, raw, ctx.now);
  });

  authedHandler<PlanUpdateResult>("plan:update", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId)) {
      return { ok: false, error: "InvalidArgs" };
    }
    const args: UpdateTaskArgs = {};
    if (raw.title !== undefined) {
      if (typeof raw.title !== "string") return { ok: false, error: "InvalidArgs" };
      args.title = raw.title;
    }
    if (raw.notes !== undefined) {
      if (raw.notes !== null && typeof raw.notes !== "string") return { ok: false, error: "InvalidArgs" };
      args.notes = raw.notes as string | null;
    }
    if (raw.dueAt !== undefined) {
      if (raw.dueAt !== null && typeof raw.dueAt !== "number") return { ok: false, error: "InvalidArgs" };
      args.dueAt = raw.dueAt as number | null;
    }
    if (raw.scheduledStart !== undefined) {
      if (raw.scheduledStart !== null && typeof raw.scheduledStart !== "number") return { ok: false, error: "InvalidArgs" };
      args.scheduledStart = raw.scheduledStart as number | null;
    }
    if (raw.scheduledEnd !== undefined) {
      if (raw.scheduledEnd !== null && typeof raw.scheduledEnd !== "number") return { ok: false, error: "InvalidArgs" };
      args.scheduledEnd = raw.scheduledEnd as number | null;
    }
    return updateTask(ctx.db, ctx.userId, raw.taskId, args, ctx.now);
  });

  authedHandler<PlanMoveToDateResult>("plan:moveToDate", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId) || typeof raw.targetDayMs !== "number") {
      return { ok: false, error: "InvalidArgs" };
    }
    return moveToDate(ctx.db, ctx.userId, raw.taskId, raw.targetDayMs as number, ctx.now);
  });

  authedHandler<PlanPushByResult>("plan:pushBy", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId) || typeof raw.offsetMs !== "number") {
      return { ok: false, error: "InvalidArgs" };
    }
    return pushBy(ctx.db, ctx.userId, raw.taskId, raw.offsetMs as number, ctx.now);
  });

  authedHandler<PlanUnscheduleResult>("plan:toBacklog", (ctx, raw) => {
    if (!isStringId(raw)) return { ok: false, error: "InvalidArgs" };
    return unscheduleTask(ctx.db, ctx.userId, raw, ctx.now);
  });

  authedHandler<PlanDropFromTodayResult>("plan:dropFromToday", (ctx, raw) => {
    if (!isStringId(raw)) return { ok: false, error: "InvalidArgs" };
    return dropFromToday(ctx.db, ctx.userId, raw, ctx.now);
  });
}
