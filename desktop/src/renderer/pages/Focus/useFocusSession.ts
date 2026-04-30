import type { FocusSessionItem } from "../../../preload/api-types";
import { useResource } from "../../hooks/useResource";

// CL-09b session state hook. Built on the shared useResource state
// machine (REFACTOR-AUDIT-4); the page renders via PageStateView.
//
// `data` is the open session, or null when there isn't one — the
// page branches on null to show the chooser.

export function useFocusSession() {
  return useResource<FocusSessionItem | null>(async () => {
    const r = await window.calmly.focus.current();
    if (!r.ok) return { kind: "signed-out" };
    return { kind: "ok", data: r.session };
  }, []);
}
