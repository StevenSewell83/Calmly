import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import {
  carryForward,
  completeShutdown,
  dropTasks,
  markTasksDone,
  moveToDate,
  saveReflection,
  summarize,
  type BulkResult,
  type CompleteShutdownResult,
  type ReviewSummary,
  type SaveReflectionResult,
} from "../review/store";

let registered = false;

export type ReviewSummaryResult =
  | { ok: true; summary: ReviewSummary }
  | { ok: false; error: "NotSignedIn" };

export type ReviewBulkResult =
  | BulkResult
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export type ReviewSaveReflectionResult =
  | SaveReflectionResult
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export type ReviewCompleteShutdownResult =
  | CompleteShutdownResult
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

interface BulkInvoke {
  taskIds: unknown;
}

interface MoveToDateInvoke extends BulkInvoke {
  dueAt: unknown;
}

interface SaveReflectionInvoke {
  date: unknown;
  text: unknown;
}

interface CompleteShutdownInvoke {
  date: unknown;
  reflection: unknown;
}

function isStringIdArray(v: unknown): v is string[] {
  return (
    Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0)
  );
}

function isYmdString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function registerReviewIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("review:summary", (): ReviewSummaryResult => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    const tz = new Date().getTimezoneOffset();
    return {
      ok: true,
      summary: summarize(getDb(), user.id, Date.now(), tz),
    };
  });

  ipcMain.handle(
    "review:carryForward",
    (_e, payload: BulkInvoke): ReviewBulkResult => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (!payload || !isStringIdArray(payload.taskIds)) {
        return { ok: false, error: "InvalidArgs" };
      }
      return carryForward(getDb(), user.id, payload.taskIds, Date.now());
    },
  );

  ipcMain.handle(
    "review:drop",
    (_e, payload: BulkInvoke): ReviewBulkResult => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (!payload || !isStringIdArray(payload.taskIds)) {
        return { ok: false, error: "InvalidArgs" };
      }
      return dropTasks(getDb(), user.id, payload.taskIds, Date.now());
    },
  );

  ipcMain.handle(
    "review:markDone",
    (_e, payload: BulkInvoke): ReviewBulkResult => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (!payload || !isStringIdArray(payload.taskIds)) {
        return { ok: false, error: "InvalidArgs" };
      }
      return markTasksDone(getDb(), user.id, payload.taskIds, Date.now());
    },
  );

  ipcMain.handle(
    "review:moveToDate",
    (_e, payload: MoveToDateInvoke): ReviewBulkResult => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (
        !payload ||
        !isStringIdArray(payload.taskIds) ||
        typeof payload.dueAt !== "number" ||
        !Number.isFinite(payload.dueAt) ||
        payload.dueAt < 0
      ) {
        return { ok: false, error: "InvalidArgs" };
      }
      return moveToDate(
        getDb(),
        user.id,
        payload.taskIds,
        payload.dueAt,
        Date.now(),
      );
    },
  );

  ipcMain.handle(
    "review:saveReflection",
    (_e, payload: SaveReflectionInvoke): ReviewSaveReflectionResult => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (
        !payload ||
        !isYmdString(payload.date) ||
        typeof payload.text !== "string"
      ) {
        return { ok: false, error: "InvalidArgs" };
      }
      return saveReflection(
        getDb(),
        user.id,
        payload.date,
        payload.text,
        Date.now(),
      );
    },
  );

  ipcMain.handle(
    "review:completeShutdown",
    (
      _e,
      payload: CompleteShutdownInvoke,
    ): ReviewCompleteShutdownResult => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      if (!payload || !isYmdString(payload.date)) {
        return { ok: false, error: "InvalidArgs" };
      }
      const reflection =
        payload.reflection === null
          ? null
          : typeof payload.reflection === "string"
            ? payload.reflection
            : undefined;
      if (reflection === undefined) {
        return { ok: false, error: "InvalidArgs" };
      }
      return completeShutdown(
        getDb(),
        user.id,
        payload.date,
        reflection,
        Date.now(),
      );
    },
  );
}
