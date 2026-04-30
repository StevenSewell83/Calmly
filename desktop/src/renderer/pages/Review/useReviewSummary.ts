import { useCallback, useEffect, useState } from "react";
import type { ReviewSummary } from "../../../preload/api-types";

// CL-13 review-page hook — mirrors usePlanForDay's discriminated-
// union shape so the Review component drives all visual state from
// the same handful of branches.

export type ReviewState =
  | { kind: "loading" }
  | { kind: "ready"; summary: ReviewSummary }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export function useReviewSummary(): {
  state: ReviewState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<ReviewState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const r = await window.calmly.review.summary();
      if (!r.ok) {
        setState({ kind: "signed-out" });
        return;
      }
      setState({ kind: "ready", summary: r.summary });
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
