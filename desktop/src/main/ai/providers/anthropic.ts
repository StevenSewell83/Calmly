import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, AIError, Result } from "../types";

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 30_000;

export class AnthropicProvider implements AIProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS });
  }

  async complete(systemPrompt: string, userPrompt: string): Promise<Result<string>> {
    try {
      const msg = await this.client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      });

      const block = msg.content[0];
      if (block?.type !== "text") {
        return { ok: false, error: { kind: "invalid_response", raw: JSON.stringify(msg.content) } };
      }
      return { ok: true, value: block.text };
    } catch (err) {
      return { ok: false, error: categorizeError(err) };
    }
  }
}

function categorizeError(err: unknown): AIError {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return { kind: "auth" };
    if (err.status === 429) return { kind: "quota" };
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { kind: "timeout" };
  if (err instanceof Anthropic.APIConnectionError) return { kind: "network" };
  return { kind: "unknown", cause: err };
}
