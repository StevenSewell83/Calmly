import { useState, useCallback, useRef } from "react";
import type { AIError } from "../../preload/api-types";

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
  | { kind: "error"; error: AIError };

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
        setState({ kind: "error", error: result.error });
        return;
      }

      setState({
        kind: "done",
        suggestionId: result.value.suggestionId,
        suggestion: result.value.result as TriageCleanupResult,
      });
    } catch {
      if (!ctrl.signal.aborted) {
        setState({ kind: "error", error: { kind: "unknown" } });
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
