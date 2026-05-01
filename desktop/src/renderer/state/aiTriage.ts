import { useState, useCallback, useRef } from "react";

export type TriageCleanupResult = {
  type: "task" | "event" | "someday";
  title: string;
  dueDate?: string;
  nextAction?: string;
};

export type AITriageState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; suggestionId: string; suggestion: TriageCleanupResult }
  | { kind: "error"; message: string };

export function useAiTriage() {
  const [state, setState] = useState<AITriageState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async (rawText: string) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState({ kind: "loading" });

    try {
      const result = await window.calmly.ai.run("triage_cleanup", { rawText });
      if (ctrl.signal.aborted) return;

      if (!result.ok) {
        const msg = errorMessage(result.error.kind);
        setState({ kind: "error", message: msg });
        return;
      }

      setState({
        kind: "done",
        suggestionId: result.value.suggestionId,
        suggestion: result.value.result as TriageCleanupResult,
      });
    } catch {
      if (!ctrl.signal.aborted) {
        setState({ kind: "error", message: "Something went wrong. Try again." });
      }
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState({ kind: "idle" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({ kind: "idle" });
  }, []);

  return { state, run, cancel, reset };
}

function errorMessage(kind: string): string {
  switch (kind) {
    case "auth": return "API key is missing or invalid. Check Settings → AI.";
    case "quota": return "Rate limit reached. Try again in a moment.";
    case "network": return "Network error. Check your connection.";
    case "timeout": return "Request timed out. Try again.";
    default: return "AI returned an unexpected response. Try again.";
  }
}
