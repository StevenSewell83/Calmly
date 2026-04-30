import type { PlanForDay } from "../../../preload/api-types";
import { useResource } from "../../hooks/useResource";

export interface PlanReady {
  plan: PlanForDay;
  day: number;
}

// Plan view's day-anchored read. Returns the standard ResourceState
// machine from useResource (REFACTOR-AUDIT-4); the page renders via
// PageStateView.
export function usePlanForDay(day: number) {
  return useResource<PlanReady>(async () => {
    const r = await window.calmly.plan.listForDay(day);
    if (!r.ok) return { kind: "signed-out" };
    return { kind: "ok", data: { plan: r.plan, day: r.day } };
  }, [day]);
}
