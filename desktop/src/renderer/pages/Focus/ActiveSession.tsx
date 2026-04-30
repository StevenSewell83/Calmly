import { useEffect, useState } from "react";
import { Check, CircleHelp, LogOut, Pause, Replace, Timer } from "lucide-react";
import type {
  FocusSessionItem,
  PlanTaskItem,
} from "../../../preload/api-types";
import {
  formatElapsed,
  formatScheduledWindow,
  nextStepFor,
} from "./focusUtils";

interface Props {
  session: FocusSessionItem;
  // Today's full task list (scheduled ∪ backlog) so we can derive the
  // active task's row, parent, and next-step child without an extra IPC.
  todaysTasks: PlanTaskItem[];
  onMarkDone: () => void;
  onSwitch: () => void;
  onEnd: () => void;
}

// CL-09b active-session hero. Big task title + parent chain + next-step
// sub-line + soft time pill. Primary 'Mark done' / secondary 'Switch'
// + 'I'm stuck' (disabled until CL-STUCK-PROMPTS) + 'End focus'.
//
// Time policy: scheduled window shown small + grey when present;
// elapsed timer behind a toggle so the page doesn't ambiently nag.
export function ActiveSession({
  session,
  todaysTasks,
  onMarkDone,
  onSwitch,
  onEnd,
}: Props): JSX.Element {
  const task = todaysTasks.find((t) => t.id === session.task_id) ?? null;
  const parent =
    task?.parent_task_id != null
      ? (todaysTasks.find((t) => t.id === task.parent_task_id) ?? null)
      : null;
  const nextStep = task ? nextStepFor(task, todaysTasks) : null;
  const window = task
    ? formatScheduledWindow(task.scheduled_start, task.scheduled_end)
    : null;

  const [showElapsed, setShowElapsed] = useState<boolean>(false);
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!showElapsed) return;
    const id = window === null ? 60_000 : 30_000;
    const t = setInterval(() => setNow(Date.now()), id);
    return () => clearInterval(t);
  }, [showElapsed, window]);

  return (
    <div className="max-w-3xl">
      {parent ? (
        <p className="text-[11px] tracking-[0.18em] uppercase text-stone-400 font-bold mb-3">
          Part of · {parent.title}
        </p>
      ) : null}

      <h1 className="font-serif italic text-5xl tracking-tight text-stone-800 leading-tight">
        {task ? task.title : "Focused task"}
      </h1>

      {nextStep ? (
        <p className="mt-4 text-base text-stone-500 leading-relaxed max-w-2xl">
          <span className="text-stone-400 mr-2">Next step ·</span>
          {nextStep}
        </p>
      ) : null}

      <div className="mt-8 flex items-center gap-3 flex-wrap">
        {window ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-stone-100/60 text-xs text-stone-500 tracking-wide font-medium">
            <Pause className="w-3.5 h-3.5" aria-hidden="true" />
            {window}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setShowElapsed((v) => !v)}
          className={[
            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs tracking-wide font-medium transition-colors",
            showElapsed
              ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
              : "text-stone-400 hover:text-stone-600 hover:bg-stone-100",
          ].join(" ")}
          aria-pressed={showElapsed}
        >
          <Timer className="w-3.5 h-3.5" aria-hidden="true" />
          {showElapsed
            ? formatElapsed(now - session.started_at)
            : "Show elapsed"}
        </button>
      </div>

      <div className="mt-12 flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onMarkDone}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 text-white text-sm font-medium tracking-wide hover:bg-emerald-700 transition-colors"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          Mark done
        </button>
        <button
          type="button"
          onClick={onSwitch}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white border border-stone-200 text-sm font-medium tracking-wide text-stone-700 hover:border-stone-300 hover:bg-stone-50 transition-colors"
        >
          <Replace className="w-4 h-4" aria-hidden="true" />
          Switch task
        </button>
        <button
          type="button"
          disabled
          title="Guided prompts land in CL-STUCK-PROMPTS"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white border border-stone-200/60 text-sm font-medium tracking-wide text-stone-400 cursor-not-allowed"
        >
          <CircleHelp className="w-4 h-4" aria-hidden="true" />
          I&rsquo;m stuck
        </button>
        <button
          type="button"
          onClick={onEnd}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium tracking-wide text-stone-500 hover:bg-stone-100 transition-colors"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          End focus
        </button>
      </div>
    </div>
  );
}
