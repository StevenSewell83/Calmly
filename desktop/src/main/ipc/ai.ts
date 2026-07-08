import { runAI, type AIRunOptions } from "../ai";
import { recordOutcome } from "../ai/persistence";
import { readTodayUsage } from "../ai/usage";
import { globalRateLimiter } from "../ai/rateLimiter";
import { authedHandler } from "./handler";
import type { AIAction } from "../ai/types";
import type { SuggestionOutcome, OwnerType } from "../ai/persistence";

export function registerAiIpc(): void {
  authedHandler("ai:run", async (ctx, raw) => {
    const args = raw as unknown[];
    const [action, payload, ownerType, ownerId] = args;
    if (typeof action !== "string") {
      return { ok: false, error: { kind: "unknown", cause: "Invalid action" } };
    }
    const opts: AIRunOptions = { userId: ctx.userId };
    if (typeof ownerType === "string") opts.ownerType = ownerType as OwnerType;
    if (typeof ownerId === "string") opts.ownerId = ownerId;
    return runAI(
      {
        action: action as AIAction,
        payload: (payload ?? {}) as Record<string, unknown>,
      },
      opts,
    );
  });

  authedHandler("ai:recordOutcome", (_ctx, raw) => {
    const args = raw as unknown[];
    const [suggestionId, outcome, editedJson] = args;
    if (typeof suggestionId !== "string" || typeof outcome !== "string") {
      return { ok: false, error: "BadPayload" };
    }
    try {
      recordOutcome(suggestionId, outcome as SuggestionOutcome, editedJson);
      return { ok: true };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "InternalError",
      };
    }
  });

  authedHandler("ai:getUsage", (ctx) => ({
    ok: true,
    usage: readTodayUsage(ctx.userId),
    rateLimiter: {
      suspended: globalRateLimiter.isSuspended,
      suspendedUntilMs: globalRateLimiter.suspendedUntilMs,
    },
  }));
}
