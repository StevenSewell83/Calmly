import { useCallback, useEffect, useState } from "react";
import type { FocusSessionItem } from "../../../preload/api-types";

// CL-09b session state hook. Mirrors the discriminated-union shape of
// usePlanForDay / useReviewSummary so the Focus page drives all
// visual state from the same handful of branches.

export type FocusSessionState =
  | { kind: "loading" }
  | { kind: "ready"; session: FocusSessionItem | null }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export function useFocusSession(): {
  state: FocusSessionState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<FocusSessionState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const r = await window.calmly.focus.current();
      if (!r.ok) {
        setState({ kind: "signed-out" });
        return;
      }
      setState({ kind: "ready", session: r.session });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}
