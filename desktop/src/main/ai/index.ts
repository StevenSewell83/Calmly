import { z } from "zod";
import { secretStore } from "../security/secretStore";
import { AnthropicProvider } from "./providers/anthropic";
import type { AIAction, AIRequest, AIError, Result } from "./types";
import {
  buildTriageCleanupPrompts,
  TriageCleanupOutputSchema,
} from "./prompts/triageCleanup";
import {
  buildMakeStartablePrompts,
  MakeStartableOutputSchema,
} from "./prompts/makeStartable";
import {
  buildBrainDumpSplitPrompts,
  BrainDumpSplitOutputSchema,
} from "./prompts/brainDumpSplit";
import { recordPending, type OwnerType } from "./persistence";
import { recordUsage } from "./usage";
import { globalRateLimiter } from "./rateLimiter";

const ANTHROPIC_KEY = "ai.anthropic.key";
const MODEL_ID = "claude-haiku-4-5-20251001";

const ACTION_SCHEMAS: Record<AIAction, z.ZodTypeAny> = {
  triage_cleanup: TriageCleanupOutputSchema,
  make_startable: MakeStartableOutputSchema,
  brain_dump_split: BrainDumpSplitOutputSchema,
};

export interface AIRunOptions {
  ownerType?: OwnerType;
  ownerId?: string;
  userId?: string;
}

export interface AIRunResponse {
  action: AIAction;
  result: unknown;
  suggestionId: string;
}

export async function runAI(
  req: AIRequest,
  opts?: AIRunOptions,
): Promise<Result<AIRunResponse>> {
  // Rate limiter check
  const waitMs = globalRateLimiter.check();
  if (waitMs > 0) {
    // Queue the request with a delay
    await new Promise((r) => setTimeout(r, waitMs));
  }

  const key = secretStore.get(ANTHROPIC_KEY);
  if (!key) return { ok: false, error: { kind: "auth" } };

  const provider = new AnthropicProvider(key);

  let prompts: { system: string; user: string };
  if (req.action === "triage_cleanup") {
    prompts = buildTriageCleanupPrompts(
      req.payload as Parameters<typeof buildTriageCleanupPrompts>[0],
    );
  } else if (req.action === "make_startable") {
    prompts = buildMakeStartablePrompts(
      req.payload as Parameters<typeof buildMakeStartablePrompts>[0],
    );
  } else if (req.action === "brain_dump_split") {
    prompts = buildBrainDumpSplitPrompts(
      req.payload as Parameters<typeof buildBrainDumpSplitPrompts>[0],
    );
  } else {
    return {
      ok: false,
      error: {
        kind: "unknown",
        cause: `Unknown action: ${String(req.action)}`,
      },
    };
  }

  const raw = await provider.complete(prompts.system, prompts.user);
  if (!raw.ok) {
    if (raw.error.kind === "quota") globalRateLimiter.onQuotaError();
    return raw;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.value);
  } catch {
    return { ok: false, error: { kind: "invalid_response", raw: raw.value } };
  }

  const schema = ACTION_SCHEMAS[req.action];
  const validation = schema.safeParse(parsed);
  if (!validation.success) {
    return { ok: false, error: { kind: "invalid_response", raw: raw.value } };
  }

  const suggestionId = recordPending({
    ownerType: opts?.ownerType,
    ownerId: opts?.ownerId,
    model: MODEL_ID,
    promptClass: req.action,
    suggestionJson: validation.data,
  });

  // Record token usage if userId is available
  if (opts?.userId) {
    const inputTokens = Math.ceil(
      (prompts.system.length + prompts.user.length) / 4,
    );
    const outputTokens = Math.ceil(raw.value.length / 4);
    recordUsage(opts.userId, {
      promptClass: req.action,
      inputTokens,
      outputTokens,
      model: MODEL_ID,
    });
  }

  return {
    ok: true,
    value: { action: req.action, result: validation.data, suggestionId },
  };
}

export type { AIAction, AIRequest, AIError, Result };
