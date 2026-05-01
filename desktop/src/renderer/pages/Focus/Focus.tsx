import { useCallback, useEffect, useState } from "react";
import { Target, Sparkles } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatClock } from "../../utils/time";
import { ActiveSession } from "./ActiveSession";
import { AdHocStart } from "./AdHocStart";
import { useFocusSession } from "./useFocusSession";
import { EmptyState } from "../../components/EmptyState";
import { MakeStartableModal, type MakeStartableResult } from "../../components/ai/MakeStartableModal";

type MakeStartableModalState =
  | { kind: "loading"; task: PlanTaskItem }
  | { kind: "done"; task: PlanTaskItem; suggestionId: string; suggestion: MakeStartableResult }
  | { kind: "error"; task: PlanTaskItem; message: string }
  | null;

export function Focus() {
  const { state, startFocus, endFocus, markDone, switchTask, refresh } = useFocusSession();
  const [adHocOpen, setAdHocOpen] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [makeStartable, setMakeStartable] = useState<MakeStartableModalState>(null);

  useEffect(() => {
    void window.calmly.ai.getSettings().then((s) => setAiEnabled(s.enabled)).catch(() => {});
  }, []);

  const handleMakeStartable = useCallback(async (task: PlanTaskItem) => {
    setMakeStartable({ kind: "loading", task });
    try {
      const r = await window.calmly.ai.run("make_startable", { title: task.title, notes: task.notes ?? "" }, "task", task.id);
      if (!r.ok) {
        const msg = r.error.kind === "auth" ? "API key missing. Check Settings → AI."
          : r.error.kind === "quota" ? "Rate limit. Try again shortly."
          : r.error.kind === "network" ? "Network error."
          : r.error.kind === "timeout" ? "Request timed out."
          : "Unexpected response.";
        setMakeStartable({ kind: "error", task, message: msg });
        return;
      }
      const suggestion = r.value.result as MakeStartableResult;
      setMakeStartable({ kind: "done", task, suggestionId: r.value.suggestionId, suggestion });
    } catch {
      setMakeStartable((s) => s ? { kind: "error", task: s.task, message: "Something went wrong." } : null);
    }
  }, []);

  const handleApply = useCallback(async (result: MakeStartableResult, suggestionId: string, edited: boolean) => {
    await window.calmly.ai.recordOutcome(suggestionId, edited ? "edited" : "accepted", edited ? result : undefined);
    setMakeStartable(null);
  }, []);

  const handleReject = useCallback(async (suggestionId: string) => {
    await window.calmly.ai.recordOutcome(suggestionId, "rejected");
    setMakeStartable(null);
  }, []);

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
              <TaskChooserRow
                key={t.id}
                task={t}
                onStart={() => void startFocus(t.id)}
                aiEnabled={aiEnabled}
                onMakeStartable={() => void handleMakeStartable(t)}
              />
            ))}
          </ul>
        )}

        {state.todayTasks.length === 0 && !adHocOpen && (
          <EmptyState
            name="focus-no-tasks"
            title="No focus right now."
            body="Start an ad-hoc focus block, or pick from any open task."
            primaryAction={{ label: "Start ad-hoc focus", onClick: () => setAdHocOpen(true) }}
          />
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

    {/* Make Startable modal */}
    {makeStartable && (
      <MakeStartableModal
        taskId={makeStartable.task.id}
        taskTitle={makeStartable.task.title}
        taskNotes={makeStartable.task.notes}
        state={makeStartable.kind === "loading"
          ? { kind: "loading" }
          : makeStartable.kind === "error"
            ? { kind: "error", message: makeStartable.message }
            : { kind: "done", suggestionId: makeStartable.suggestionId, suggestion: makeStartable.suggestion }}
        onClose={() => setMakeStartable(null)}
        onApply={handleApply}
        onReject={handleReject}
      />
    )}
  );
}

interface RowProps {
  task: PlanTaskItem;
  onStart(): void;
  aiEnabled: boolean;
  onMakeStartable(): void;
}

function TaskChooserRow({ task, onStart, aiEnabled, onMakeStartable }: RowProps) {
  return (
    <li>
      <div className="group flex items-center gap-2 px-5 py-4 rounded-[1.8rem] bg-white border border-stone-100 shadow-sm hover:border-emerald-200 hover:shadow-md transition-all">
        <button
          onClick={onStart}
          className="flex-1 text-left min-w-0"
        >
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-stone-800 group-hover:text-emerald-700 truncate">{task.title}</p>
              {task.scheduled_start !== null && (
                <p className="text-xs text-stone-400 mt-0.5">{formatClock(task.scheduled_start)}</p>
              )}
            </div>
            <span className="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
              <Target className="w-3.5 h-3.5" />
              Start
            </span>
          </div>
        </button>
        {aiEnabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onMakeStartable(); }}
            title="Make Startable"
            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 w-7 h-7 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 flex items-center justify-center"
          >
            <Sparkles size={13} />
          </button>
        )}
      </div>
    </li>
  );
}
