import { ipcMain } from "electron";
import type Database from "better-sqlite3";
import { getCurrentUser } from "../auth/currentUser";
import { getDb } from "../db";

// Canonical IPC handler factory. Eliminates per-module boilerplate:
// auth check, tz/now injection, double-registration guard.
//
// Usage:
//   authedHandler("channel:name", (ctx, raw) => { ... })
//
// The callback receives a validated context (userId, db, now, tz) and
// the raw IPC payload. Validate the payload inside the callback and
// return { ok: false, error: "InvalidArgs" } for bad input. Thrown
// errors are caught and returned as InternalError.
//
// When the renderer calls ipcRenderer.invoke(channel, a, b, ...) with
// multiple args, `raw` is an array of those args (multi-arg IPC is
// rare — only inbox:snooze uses it). Single-arg calls pass the value
// directly so callers don't need to unwrap.

export interface HandlerCtx {
  userId: string;
  db: Database.Database;
  now: number;
  tz: number;
}

// Registered channel names — prevents double-registration across
// hot reloads in dev without per-module `let registered` flags.
const registered = new Set<string>();

export function authedHandler<R>(
  channel: string,
  fn: (ctx: HandlerCtx, raw: unknown) => Promise<R> | R,
): void {
  if (registered.has(channel)) return;
  registered.add(channel);

  ipcMain.handle(
    channel,
    async (_e: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<R | { ok: false; error: "NotSignedIn" | "InternalError" }> => {
      const user = getCurrentUser();
      if (!user) return { ok: false, error: "NotSignedIn" };
      const ctx: HandlerCtx = {
        userId: user.id,
        db: getDb(),
        now: Date.now(),
        tz: new Date().getTimezoneOffset(),
      };
      try {
        // Single-arg calls (the common case) pass the value directly.
        // Multi-arg calls (e.g. inbox:snooze) pass args as an array.
        const raw = args.length === 1 ? args[0] : args;
        return await fn(ctx, raw);
      } catch (err) {
        console.error(`[ipc:${channel}] unexpected error`, err);
        return { ok: false, error: "InternalError" } as unknown as R;
      }
    },
  );
}

// Shared validators used across multiple handlers.
export function isStringId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
