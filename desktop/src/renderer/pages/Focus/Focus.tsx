import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PlanTaskItem } from "../../../preload/api-types";
import { FailureNotice } from "../../components/PageStateView";
import { usePlanForDay } from "../Plan/usePlanForDay";
import { ActiveSession } from "./ActiveSession";
import { Chooser } from "./Chooser";
import { focusableTasks, sourceForTask } from "./focusUtils";
import { SwitchTaskPicker } from "./SwitchTaskPicker";
import { useFocusSession } from "./useFocusSession";

// CL-09b Focus mode page. Branches on session existence:
//   - active session → ActiveSession + optional SwitchTaskPicker
//   - no session     → Chooser populated from today's plan
//
// Both branches consume the same plan.listForDay() snapshot so we can
// derive the active task's row, parent, and next-step child without an
// extra IPC. CL-FOCUS-ADHOC will widen the chooser source when ad-hoc
// blocks land.

export function Focus(): JSX.Element {
  const navigate = useNavigate();
  const today = useMemo(() => Date.now(), []);
  const planForDay = usePlanForDay(today);
  const focus = useFocusSession();

  const [pickerOpen, setPickerOpen] = useState(false);

  const refreshAll = useCallback(async () => {
    await Promise.all([planForDay.refresh(), focus.refresh()]);
  }, [focus, planForDay]);

  const startFocus = useCallback(
    async (task: PlanTaskItem) => {
      const r = await window.calmly.focus.start({
        taskId: task.id,
        source: sourceForTask(task),
      });
      if (r.ok) await refreshAll();
    },
    [refreshAll],
  );

  const switchFocus = useCallback(
    async (task: PlanTaskItem) => {
      const r = await window.calmly.focus.switch({
        taskId: task.id,
        source: sourceForTask(task),
      });
      if (r.ok) {
        setPickerOpen(false);
        await refreshAll();
      }
    },
    [refreshAll],
  );

  const markDone = useCallback(async () => {
    const r = await window.calmly.focus.markDone();
    if (r.ok) await refreshAll();
  }, [refreshAll]);

  const endFocus = useCallback(async () => {
    const r = await window.calmly.focus.end();
    if (r.ok) await refreshAll();
  }, [refreshAll]);

  // While either read is in flight, treat the page as loading.
  // signed-out / error from EITHER read collapses to the same shell.
  if (planForDay.state.kind === "loading" || focus.state.kind === "loading") {
    return (
      <Frame>
        <LoadingShell />
      </Frame>
    );
  }
  if (
    planForDay.state.kind === "signed-out" ||
    focus.state.kind === "signed-out"
  ) {
    return (
      <Frame>
        <FailureNotice
          title="You're signed out."
          body="Sign in to enter focus mode."
        />
      </Frame>
    );
  }
  if (planForDay.state.kind === "error") {
    return (
      <Frame>
        <FailureNotice
          title="Something hiccuped."
          body={planForDay.state.message}
        />
      </Frame>
    );
  }
  if (focus.state.kind === "error") {
    return (
      <Frame>
        <FailureNotice
          title="Something hiccuped."
          body={focus.state.message}
        />
      </Frame>
    );
  }

  const todaysTasks = focusableTasks(
    planForDay.state.data.plan.scheduled,
    planForDay.state.data.plan.backlog,
  );
  const session = focus.state.data;

  if (session) {
    return (
      <Frame>
        <ActiveSession
          session={session}
          todaysTasks={todaysTasks}
          onMarkDone={() => void markDone()}
          onSwitch={() => setPickerOpen(true)}
          onEnd={() => void endFocus().then(() => navigate("/"))}
        />
        <SwitchTaskPicker
          open={pickerOpen}
          tasks={todaysTasks.filter((t) => t.id !== session.task_id)}
          onPick={(t) => void switchFocus(t)}
          onClose={() => setPickerOpen(false)}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <ChooserHeader />
      <Chooser
        scheduled={planForDay.state.data.plan.scheduled}
        backlog={planForDay.state.data.plan.backlog}
        onPick={(t) => void startFocus(t)}
      />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {children}
    </section>
  );
}

function ChooserHeader(): JSX.Element {
  return (
    <header className="mb-10 max-w-3xl">
      <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
        Pick one thing.
      </h1>
      <p className="mt-3 text-sm text-stone-400 tracking-wide">
        Focus narrows the field. Choose what gets your attention next.
      </p>
    </header>
  );
}

function LoadingShell(): JSX.Element {
  return (
    <div role="status" aria-label="Loading focus" className="max-w-3xl">
      <div className="rounded-[1.6rem] bg-stone-100/60 h-12 animate-pulse mb-6" />
      <div className="rounded-[1.4rem] bg-stone-100/60 h-20 animate-pulse mb-3" />
      <div className="rounded-[1.4rem] bg-stone-100/60 h-20 animate-pulse" />
    </div>
  );
}

