import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusSessionItem, PlanTaskItem } from "../../../preload/api-types";

export interface FocusState {
  loading: boolean;
  session: FocusSessionItem | null;
  task: PlanTaskItem | null;
  todayTasks: PlanTaskItem[];
}

export function useFocusSession() {
  const [state, setState] = useState<FocusState>({
    loading: true,
    session: null,
    task: null,
    todayTasks: [],
  });
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const [sessionRes, planRes] = await Promise.all([
      window.calmly.focus.current(),
      window.calmly.plan.listForDay(),
    ]);
    if (!mounted.current) return;
    const allTasks = planRes.ok ? [...planRes.plan.scheduled, ...planRes.plan.backlog] : [];
    const session = sessionRes.ok ? sessionRes.session : null;
    const task = session ? (allTasks.find((t) => t.id === session.task_id) ?? null) : null;
    setState({ loading: false, session, task, todayTasks: allTasks });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const startFocus = async (taskId: string) => {
    const source = state.todayTasks.find((t) => t.id === taskId)?.scheduled_start !== null
      ? ("scheduled" as const)
      : ("ad-hoc" as const);
    await window.calmly.focus.start({ taskId, source });
    await refresh();
  };

  const endFocus = async () => {
    await window.calmly.focus.end();
    await refresh();
  };

  const markDone = async () => {
    await window.calmly.focus.markDone();
    await refresh();
  };

  const switchTask = async (taskId: string) => {
    const source = state.todayTasks.find((t) => t.id === taskId)?.scheduled_start !== null
      ? ("scheduled" as const)
      : ("ad-hoc" as const);
    await window.calmly.focus.switch({ taskId, source });
    await refresh();
  };

  return { state, startFocus, endFocus, markDone, switchTask, refresh };
}
