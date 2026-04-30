import { randomUUID } from "node:crypto";
import {
  pushBy,
  unscheduleTask,
  scheduleTask,
  moveToDate,
  listForDay,
} from "../plan/store";
import { authedHandler, isObject, isStringId } from "./handler";

type ReplanReason = "ran_late" | "got_stuck" | "priorities_changed" | "other" | null;

export function registerReplanIpc(): void {
  authedHandler<{ ok: true } | { ok: false; error: string }>(
    "replan:recordEvent",
    (ctx, raw) => {
      const reason = (isObject(raw) ? raw.reason : null) as ReplanReason;
      ctx.db
        .prepare(`INSERT INTO replan_events (id, user_id, reason, created_at) VALUES (?, ?, ?, ?)`)
        .run(randomUUID(), ctx.userId, reason, ctx.now);
      return { ok: true };
    },
  );

  authedHandler<{ ok: true; applied: number } | { ok: false; error: string }>(
    "replan:applyBatch",
    (ctx, raw) => {
      if (!Array.isArray(raw)) return { ok: false, error: "InvalidArgs" };
      let applied = 0;
      for (const action of raw as unknown[]) {
        if (!isObject(action) || !isStringId(action.taskId)) continue;
        const { type, taskId } = action;
        if (type === "push" && typeof action.offsetMs === "number") {
          const r = pushBy(ctx.db, ctx.userId, taskId, action.offsetMs as number, ctx.now);
          if (r.ok) applied++;
        } else if (type === "drop") {
          const r = unscheduleTask(ctx.db, ctx.userId, taskId, ctx.now);
          if (r.ok) applied++;
        } else if (type === "shrink" && typeof action.durationMs === "number") {
          // Load task to get scheduledStart, then reschedule with new end.
          const plan = listForDay(ctx.db, ctx.userId, ctx.now, ctx.tz);
          const task = [...plan.scheduled, ...plan.backlog].find((t) => t.id === taskId);
          if (task?.scheduled_start !== null && task?.scheduled_start !== undefined) {
            const r = scheduleTask(
              ctx.db, ctx.userId, taskId,
              task.scheduled_start,
              task.scheduled_start + (action.durationMs as number),
              ctx.now,
            );
            if (r.ok) applied++;
          }
        } else if (type === "moveToDate" && typeof action.targetDayMs === "number") {
          const r = moveToDate(ctx.db, ctx.userId, taskId, action.targetDayMs as number, ctx.now);
          if (r.ok) applied++;
        }
      }
      return { ok: true, applied };
    },
  );
}
