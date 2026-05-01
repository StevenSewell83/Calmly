import { z } from "zod";
import { secretStore } from "../security/secretStore";
import { AnthropicProvider } from "./providers/anthropic";
import type { AIAction, AIRequest, AIResponse, AIError, Result } from "./types";
import { buildTriageCleanupPrompts, TriageCleanupOutputSchema } from "./prompts/triageCleanup";
import { buildMakeStartablePrompts, MakeStartableOutputSchema } from "./prompts/makeStartable";
import { buildBrainDumpSplitPrompts, BrainDumpSplitOutputSchema } from "./prompts/brainDumpSplit";

const ANTHROPIC_KEY = "ai.anthropic.key";

const ACTION_SCHEMAS: Record<AIAction, z.ZodTypeAny> = {
  triage_cleanup: TriageCleanupOutputSchema,
  make_startable: MakeStartableOutputSchema,
  brain_dump_split: BrainDumpSplitOutputSchema,
};

export async function runAI(req: AIRequest): Promise<Result<AIResponse>> {
  const key = secretStore.get(ANTHROPIC_KEY);
  if (!key) return { ok: false, error: { kind: "auth" } };

  const provider = new AnthropicProvider(key);

  let prompts: { system: string; user: string };
  if (req.action === "triage_cleanup") {
    prompts = buildTriageCleanupPrompts(req.payload as Parameters<typeof buildTriageCleanupPrompts>[0]);
  } else if (req.action === "make_startable") {
    prompts = buildMakeStartablePrompts(req.payload as Parameters<typeof buildMakeStartablePrompts>[0]);
  } else if (req.action === "brain_dump_split") {
    prompts = buildBrainDumpSplitPrompts(req.payload as Parameters<typeof buildBrainDumpSplitPrompts>[0]);
  } else {
    return { ok: false, error: { kind: "unknown", cause: `Unknown action: ${String(req.action)}` } };
  }

  const raw = await provider.complete(prompts.system, prompts.user);
  if (!raw.ok) return raw;

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

  return { ok: true, value: { action: req.action, result: validation.data } };
}

export type { AIAction, AIRequest, AIResponse, AIError, Result };
