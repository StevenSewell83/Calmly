import {
  getReviewSummary,
  carryForward,
  dropTasks,
  markDoneTasks,
  moveTaskTo,
  saveReflection,
  completeShutdown,
  type ReviewSummary,
  type CarryForwardResult,
  type DropResult,
  type MarkDoneResult,
  type MoveToResult,
  type SaveReflectionResult,
  type CompleteShutdownResult,
} from "../review/store";
import { authedHandler, isObject, isStringId } from "./handler";

export type ReviewSummaryResult =
  | { ok: true; summary: ReviewSummary }
  | { ok: false; error: "NotSignedIn" };

export type ReviewCarryForwardResult =
  | CarryForwardResult
  | { ok: false; error: "NotSignedIn" };

export type ReviewDropResult =
  | DropResult
  | { ok: false; error: "NotSignedIn" };

export type ReviewMarkDoneResult =
  | MarkDoneResult
  | { ok: false; error: "NotSignedIn" };

export type ReviewMoveToResult =
  | MoveToResult
  | { ok: false; error: "NotSignedIn" };

export type ReviewSaveReflectionResult =
  | SaveReflectionResult
  | { ok: false; error: "NotSignedIn" };

export type ReviewCompleteShutdownResult =
  | CompleteShutdownResult
  | { ok: false; error: "NotSignedIn" };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
}

export function registerReviewIpc(): void {
  authedHandler<ReviewSummaryResult>("review:summary", (ctx) => {
    return { ok: true, summary: getReviewSummary(ctx.db, ctx.userId, ctx.now, ctx.tz) };
  });

  authedHandler<ReviewCarryForwardResult>("review:carryForward", (ctx, raw) => {
    if (!isObject(raw) || !isStringArray(raw.taskIds)) return { ok: false, error: "InvalidArgs" as const };
    return carryForward(ctx.db, ctx.userId, raw.taskIds as string[], ctx.now);
  });

  authedHandler<ReviewDropResult>("review:drop", (ctx, raw) => {
    if (!isObject(raw) || !isStringArray(raw.taskIds)) return { ok: false, error: "InvalidArgs" as const };
    return dropTasks(ctx.db, ctx.userId, raw.taskIds as string[], ctx.now);
  });

  authedHandler<ReviewMarkDoneResult>("review:markDone", (ctx, raw) => {
    if (!isObject(raw) || !isStringArray(raw.taskIds)) return { ok: false, error: "InvalidArgs" as const };
    return markDoneTasks(ctx.db, ctx.userId, raw.taskIds as string[], ctx.now);
  });

  authedHandler<ReviewMoveToResult>("review:moveTo", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId) || typeof raw.targetDayMs !== "number") {
      return { ok: false, error: "InvalidArgs" as const };
    }
    return moveTaskTo(ctx.db, ctx.userId, raw.taskId, raw.targetDayMs as number, ctx.now);
  });

  authedHandler<ReviewSaveReflectionResult>("review:saveReflection", (ctx, raw) => {
    if (!isObject(raw) || typeof raw.text !== "string") return { ok: false, error: "InvalidArgs" as const };
    return saveReflection(ctx.db, ctx.userId, raw.text, ctx.now, ctx.tz);
  });

  authedHandler<ReviewCompleteShutdownResult>("review:completeShutdown", (ctx, raw) => {
    const text = isObject(raw) && typeof raw.text === "string" ? raw.text : null;
    return completeShutdown(ctx.db, ctx.userId, text, ctx.now, ctx.tz);
  });
}
