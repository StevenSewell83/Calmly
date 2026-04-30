import { useCallback, useEffect, useState } from "react";
import type { PlanForDay } from "../../../preload/api-types";

// Mirrors the discriminated-union shape used by other page-level
// hooks (useInboxList, useTodaySummary). The Plan view drives all
// visual state from these branches plus a selected `day` anchor.
export type PlanState =
  | { kind: "loading" }
  | { kind: "ready"; plan: PlanForDay; day: number }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

export function usePlanForDay(day: number): {
  state: PlanState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<PlanState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const r = await window.calmly.plan.listForDay(day);
      if (!r.ok) {
        setState({ kind: "signed-out" });
        return;
      }
      setState({ kind: "ready", plan: r.plan, day: r.day });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [day]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}
