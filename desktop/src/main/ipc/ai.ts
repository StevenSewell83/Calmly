import { ipcMain } from "electron";
import { runAI } from "../ai";
import type { AIAction } from "../ai/types";

export function registerAiIpc(): void {
  ipcMain.handle(
    "ai:run",
    async (_e, action: unknown, payload: unknown) => {
      if (typeof action !== "string") {
        return { ok: false, error: { kind: "unknown", cause: "Invalid action" } };
      }
      return runAI({ action: action as AIAction, payload: (payload ?? {}) as Record<string, unknown> });
    },
  );
}
