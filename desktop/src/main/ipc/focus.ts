import { ipcMain } from "electron";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";
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

let registered = false;

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

interface StartInvoke {
  taskId: unknown;
  source: unknown;
}

interface SwitchInvoke {
  taskId: unknown;
  source: unknown;
}

function isStringId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFocusSource(v: unknown): v is "scheduled" | "ad-hoc" {
  return v === "scheduled" || v === "ad-hoc";
}

export function registerFocusIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("focus:current", async (): Promise<FocusCurrentResult> => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    return { ok: true, session: currentFocus(getDb(), user.id) };
  });

  ipcMain.handle(
    "focus:start",
    async (_e, payload: StartInvoke): Promise<FocusStartResult> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "InvalidArgs" };
      }
      if (!isStringId(payload.taskId) || !isFocusSource(payload.source)) {
        return { ok: false, error: "InvalidArgs" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return startFocus(
        getDb(),
        user.id,
        payload.taskId,
        payload.source,
        Date.now(),
      );
    },
  );

  ipcMain.handle("focus:end", async (): Promise<FocusEndResult> => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    return endFocus(getDb(), user.id, Date.now());
  });

  ipcMain.handle("focus:markDone", async (): Promise<FocusMarkDoneResult> => {
    const user = getCurrentUser();
    if (!user) return { ok: false, error: "NotSignedIn" };
    return markDoneFromFocus(getDb(), user.id, Date.now());
  });

  ipcMain.handle(
    "focus:switch",
    async (_e, payload: SwitchInvoke): Promise<FocusSwitchResult> => {
      if (!payload || typeof payload !== "object") {
        return { ok: false, error: "InvalidArgs" };
      }
      if (!isStringId(payload.taskId) || !isFocusSource(payload.source)) {
        return { ok: false, error: "InvalidArgs" };
      }
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      return switchFocus(
        getDb(),
        user.id,
        payload.taskId,
        payload.source,
        Date.now(),
      );
    },
  );
}
