import { ipcMain } from "electron";
import { runAI, type AIRunOptions } from "../ai";
import { recordOutcome } from "../ai/persistence";
import type { AIAction } from "../ai/types";
import type { SuggestionOutcome, OwnerType } from "../ai/persistence";

export function registerAiIpc(): void {
  ipcMain.handle(
    "ai:run",
    async (_e, action: unknown, payload: unknown, ownerType?: unknown, ownerId?: unknown) => {
      if (typeof action !== "string") {
        return { ok: false, error: { kind: "unknown", cause: "Invalid action" } };
      }
      const opts: AIRunOptions = {};
      if (typeof ownerType === "string") opts.ownerType = ownerType as OwnerType;
      if (typeof ownerId === "string") opts.ownerId = ownerId;
      return runAI(
        { action: action as AIAction, payload: (payload ?? {}) as Record<string, unknown> },
        opts,
      );
    },
  );

  ipcMain.handle(
    "ai:recordOutcome",
    (_e, suggestionId: unknown, outcome: unknown, editedJson?: unknown) => {
      if (typeof suggestionId !== "string" || typeof outcome !== "string") {
        return { ok: false, error: "BadPayload" };
      }
      try {
        recordOutcome(suggestionId, outcome as SuggestionOutcome, editedJson);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "InternalError" };
      }
    },
  );
}
