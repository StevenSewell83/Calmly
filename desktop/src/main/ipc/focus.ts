import {
  currentFocus,
  endFocus,
  markDoneFromFocus,
  startFocus,
  switchFocus,
  type EndFocusResult,
  type FocusSessionRow,
  type MarkDoneResult,
  type StartFocusResult,
  type SwitchFocusResult,
} from "../focus/store";
import { authedHandler, isObject, isStringId } from "./handler";

export type FocusCurrentResult =
  | { ok: true; session: FocusSessionRow | null }
  | { ok: false; error: "NotSignedIn" };

export type FocusStartResult =
  | StartFocusResult
  | { ok: false; error: "NotSignedIn" };

export type FocusEndResult =
  | EndFocusResult
  | { ok: false; error: "NotSignedIn" };

export type FocusMarkDoneResult =
  | MarkDoneResult
  | { ok: false; error: "NotSignedIn" };

export type FocusSwitchResult =
  | SwitchFocusResult
  | { ok: false; error: "NotSignedIn" };

function isFocusSource(v: unknown): v is "scheduled" | "ad-hoc" {
  return v === "scheduled" || v === "ad-hoc";
}

export function registerFocusIpc(): void {
  authedHandler<FocusCurrentResult>("focus:current", (ctx) => ({
    ok: true,
    session: currentFocus(ctx.db, ctx.userId),
  }));

  authedHandler<FocusStartResult>("focus:start", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId) || !isFocusSource(raw.source)) {
      return { ok: false, error: "InvalidArgs" };
    }
    return startFocus(ctx.db, ctx.userId, raw.taskId, raw.source, ctx.now);
  });

  authedHandler<FocusEndResult>("focus:end", (ctx) =>
    endFocus(ctx.db, ctx.userId, ctx.now),
  );

  authedHandler<FocusMarkDoneResult>("focus:markDone", (ctx) =>
    markDoneFromFocus(ctx.db, ctx.userId, ctx.now),
  );

  authedHandler<FocusSwitchResult>("focus:switch", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId) || !isFocusSource(raw.source)) {
      return { ok: false, error: "InvalidArgs" };
    }
    return switchFocus(ctx.db, ctx.userId, raw.taskId, raw.source, ctx.now);
  });
}
