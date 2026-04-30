import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
import {
  discardInboxItem,
  resolveAsEvent,
  resolveAsTask,
  type DiscardResult,
  type ResolveResult,
} from "../triage/store";

let registered = false;

export type TriageResolveTaskResult =
  | ResolveResult
  | { ok: false; error: "NotSignedIn" };

export type TriageResolveEventResult =
  | ResolveResult
  | { ok: false; error: "NotSignedIn" };

export type TriageDiscardResult =
  | DiscardResult
  | { ok: false; error: "NotSignedIn" };

interface ResolveAsTaskInvoke {
  inboxId: unknown;
  title: unknown;
  dueAt: unknown;
}

interface ResolveAsEventInvoke {
  inboxId: unknown;
  title: unknown;
  startAt: unknown;
  endAt: unknown;
}

function isStringId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function registerTriageIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle(
    "triage:resolveAsTask",
    async (
      _e,
      payload: ResolveAsTaskInvoke,
    ): Promise<TriageResolveTaskResult> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "InvalidArgs" };
      }
      if (!isStringId(payload.inboxId) || typeof payload.title !== "string") {
        return { ok: false, error: "InvalidArgs" };
      }
      // dueAt is optional null for the 'Later' chip; reject anything else
      // that isn't a finite number so a bogus renderer can't sneak NaN in.
      if (
        payload.dueAt !== null &&
        (typeof payload.dueAt !== "number" || !Number.isFinite(payload.dueAt))
      ) {
        return { ok: false, error: "InvalidArgs" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return resolveAsTask({
        db: getDb(),
        userId: user.id,
        inboxId: payload.inboxId,
        title: payload.title,
        dueAt: payload.dueAt,
        now: Date.now(),
      });
    },
  );

  ipcMain.handle(
    "triage:resolveAsEvent",
    async (
      _e,
      payload: ResolveAsEventInvoke,
    ): Promise<TriageResolveEventResult> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "InvalidArgs" };
      }
      if (
        !isStringId(payload.inboxId) ||
        typeof payload.title !== "string" ||
        typeof payload.startAt !== "number" ||
        typeof payload.endAt !== "number"
      ) {
        return { ok: false, error: "InvalidArgs" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return resolveAsEvent({
        db: getDb(),
        userId: user.id,
        inboxId: payload.inboxId,
        title: payload.title,
        startAt: payload.startAt,
        endAt: payload.endAt,
        now: Date.now(),
      });
    },
  );

  ipcMain.handle(
    "triage:discard",
    async (_e, inboxId: unknown): Promise<TriageDiscardResult> => {
      if (!isStringId(inboxId)) return { ok: false, error: "NotFound" };
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return discardInboxItem({
        db: getDb(),
        userId: user.id,
        inboxId,
        now: Date.now(),
      });
    },
  );
}
