export type AIAction = "triage_cleanup" | "make_startable" | "brain_dump_split";

export interface AIRequest {
  action: AIAction;
  payload: Record<string, unknown>;
}

export interface AIResponse {
  action: AIAction;
  result: unknown;
}

export type AIError =
  | { kind: "auth" }
  | { kind: "quota" }
  | { kind: "network" }
  | { kind: "timeout" }
  | { kind: "invalid_response"; raw?: string }
  | { kind: "unknown"; cause?: unknown };

export type Result<T> = { ok: true; value: T } | { ok: false; error: AIError };

export interface AIProvider {
  complete(systemPrompt: string, userPrompt: string): Promise<Result<string>>;
}
