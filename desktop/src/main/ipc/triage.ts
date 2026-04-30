import {
  discardInboxItem,
  resolveAsEvent,
  resolveAsTask,
  type DiscardResult,
  type ResolveResult,
} from "../triage/store";
import { authedHandler, isObject, isStringId } from "./handler";

export type TriageResolveTaskResult =
  | ResolveResult
  | { ok: false; error: "NotSignedIn" };

export type TriageResolveEventResult =
  | ResolveResult
  | { ok: false; error: "NotSignedIn" };

export type TriageDiscardResult =
  | DiscardResult
  | { ok: false; error: "NotSignedIn" };

export function registerTriageIpc(): void {
  authedHandler<TriageResolveTaskResult>("triage:resolveAsTask", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.inboxId) || typeof raw.title !== "string") {
      return { ok: false, error: "InvalidArgs" };
    }
    if (raw.dueAt !== null && (typeof raw.dueAt !== "number" || !Number.isFinite(raw.dueAt as number))) {
      return { ok: false, error: "InvalidArgs" };
    }
    return resolveAsTask({
      db: ctx.db,
      userId: ctx.userId,
      inboxId: raw.inboxId,
      title: raw.title,
      dueAt: raw.dueAt as number | null,
      now: ctx.now,
    });
  });

  authedHandler<TriageResolveEventResult>("triage:resolveAsEvent", (ctx, raw) => {
    if (
      !isObject(raw) ||
      !isStringId(raw.inboxId) ||
      typeof raw.title !== "string" ||
      typeof raw.startAt !== "number" ||
      typeof raw.endAt !== "number"
    ) {
      return { ok: false, error: "InvalidArgs" };
    }
    return resolveAsEvent({
      db: ctx.db,
      userId: ctx.userId,
      inboxId: raw.inboxId,
      title: raw.title,
      startAt: raw.startAt as number,
      endAt: raw.endAt as number,
      now: ctx.now,
    });
  });

  authedHandler<TriageDiscardResult>("triage:discard", (ctx, raw) => {
    if (!isStringId(raw)) return { ok: false, error: "InvalidArgs" };
    return discardInboxItem({ db: ctx.db, userId: ctx.userId, inboxId: raw, now: ctx.now });
  });
}
