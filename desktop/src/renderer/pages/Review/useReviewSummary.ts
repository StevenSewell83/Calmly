import type { ReviewSummary } from "../../../preload/api-types";
import { useResource } from "../../hooks/useResource";

// CL-13 review-page hook. Built on the shared useResource state
// machine (REFACTOR-AUDIT-4); the page renders via PageStateView.

export function useReviewSummary() {
  return useResource<ReviewSummary>(async () => {
    const r = await window.calmly.review.summary();
    if (!r.ok) return { kind: "signed-out" };
    return { kind: "ok", data: r.summary };
  }, []);
}
