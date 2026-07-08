import type { PlanForDay } from "../../../preload/api-types";
import { useResource, type UseResourceReturn } from "../../hooks/useResource";

// Plan view data is plan + the canonical day the server resolved
// against (the renderer can pass any timestamp; the IPC normalizes
// to local-day midnight). Both come back together so the day picker
// stays in sync with the plan currently rendered.
export interface PlanData {
  plan: PlanForDay;
  day: number;
}

export function usePlanForDay(day: number): UseResourceReturn<PlanData> {
  return useResource<PlanData>(async () => {
    const r = await window.calmly.plan.listForDay(day);
    if (!r.ok) return { kind: "signed-out" };
    return { kind: "ok", data: { plan: r.plan, day: r.day } };
  }, [day]);
}
