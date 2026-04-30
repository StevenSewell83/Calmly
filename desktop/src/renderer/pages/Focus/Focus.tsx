import { useEffect, useState } from "react";
import { Target } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatClock } from "../../utils/time";
import { ActiveSession } from "./ActiveSession";
import { AdHocStart } from "./AdHocStart";
import { useFocusSession } from "./useFocusSession";

export function Focus() {
  const { state, startFocus, endFocus, markDone, switchTask, refresh } = useFocusSession();
  const [adHocOpen, setAdHocOpen] = useState(false);

  // Open ad-hoc input when hotkey fires from main process.
  useEffect(() => {
    return window.calmly.focus.onAdHocRequest(() => setAdHocOpen(true));
  }, []);

  if (state.loading) {
    return (
      <section className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-emerald-500 animate-spin" />
      </section>
    );
  }

  if (state.session !== null) {
    return (
      <ActiveSession
        session={state.session}
        task={state.task}
        todayTasks={state.todayTasks}
        onMarkDone={markDone}
        onEnd={endFocus}
        onSwitch={switchTask}
      />
    );
  }

  return (
    <section
      aria-label="Focus chooser"
      className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <header className="mb-8">
        <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
          Focus.
        </h1>
        <p className="mt-3 text-sm text-stone-400 tracking-wide">
          Pick something to work on.
        </p>
      </header>

      <div className="flex flex-col gap-8 max-w-lg">
        {state.todayTasks.length > 0 && (
          <ul aria-label="Today's tasks" className="space-y-2">
            {state.todayTasks.map((t) => (
              <TaskChooserRow key={t.id} task={t} onStart={() => void startFocus(t.id)} />
            ))}
          </ul>
        )}

        {state.todayTasks.length === 0 && !adHocOpen && (
          <div className="rounded-[1.8rem] border border-dashed border-stone-200 bg-white/30 px-6 py-8 text-center">
            <p className="text-sm text-stone-400 mb-3">Nothing scheduled today.</p>
            <button
              onClick={() => setAdHocOpen(true)}
              className="text-xs px-4 py-2 rounded-2xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
            >
              Start ad-hoc focus
            </button>
          </div>
        )}

        {/* Ad-hoc start section */}
        <div className="flex flex-col items-start gap-2">
          {!adHocOpen && state.todayTasks.length > 0 && (
            <button
              onClick={() => setAdHocOpen(true)}
              className="text-xs text-stone-400 hover:text-stone-600 underline underline-offset-2 transition-colors"
            >
              + Start something not on my plan
            </button>
          )}
          {adHocOpen && (
            <AdHocStart
              open={adHocOpen}
              onStarted={async () => { setAdHocOpen(false); await refresh(); }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

interface RowProps {
  task: PlanTaskItem;
  onStart(): void;
}

function TaskChooserRow({ task, onStart }: RowProps) {
  return (
    <li>
      <button
        onClick={onStart}
        className="w-full text-left px-5 py-4 rounded-[1.8rem] bg-white border border-stone-100 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all group"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-stone-800 group-hover:text-emerald-700 truncate">{task.title}</p>
            {task.scheduledStart !== null && (
              <p className="text-xs text-stone-400 mt-0.5">{formatClock(task.scheduledStart)}</p>
            )}
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
            <Target className="w-3.5 h-3.5" />
            Start
          </span>
        </div>
      </button>
    </li>
  );
}
