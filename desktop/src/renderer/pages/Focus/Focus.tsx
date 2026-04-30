import { Target } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatClock } from "../../utils/time";
import { ActiveSession } from "./ActiveSession";
import { useFocusSession } from "./useFocusSession";

export function Focus() {
  const { state, startFocus, endFocus, markDone, switchTask } = useFocusSession();

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
      <header className="mb-10">
        <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
          Focus.
        </h1>
        <p className="mt-3 text-sm text-stone-400 tracking-wide">
          Pick something to work on.
        </p>
      </header>

      {state.todayTasks.length === 0 ? (
        <div className="rounded-[1.8rem] border border-dashed border-stone-200 bg-white/30 px-6 py-10 text-center max-w-md">
          <p className="text-sm text-stone-400">Nothing scheduled today — add tasks to your plan first.</p>
        </div>
      ) : (
        <ul aria-label="Today's tasks" className="space-y-2 max-w-lg">
          {state.todayTasks.map((t) => (
            <TaskChooserRow key={t.id} task={t} onStart={() => void startFocus(t.id)} />
          ))}
        </ul>
      )}
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
