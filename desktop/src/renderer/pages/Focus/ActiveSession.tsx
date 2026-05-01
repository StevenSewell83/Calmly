import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ArrowLeftRight, Square, AlertCircle, RefreshCw, Sparkles } from "lucide-react";
import type { FocusSessionItem, PlanTaskItem } from "../../../preload/api-types";
import { SwitchTaskPicker } from "./SwitchTaskPicker";
import { StuckPrompts } from "./StuckPrompts";
import { ReplanModal } from "../../components/Replan/ReplanModal";
import { MakeStartableModal, type MakeStartableResult } from "../../components/ai/MakeStartableModal";

interface Props {
  session: FocusSessionItem;
  task: PlanTaskItem | null;
  todayTasks: PlanTaskItem[];
  onMarkDone(): Promise<void>;
  onEnd(): Promise<void>;
  onSwitch(taskId: string): Promise<void>;
}

function useElapsed(startedAt: number): string {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
  const ref = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    ref.current = setInterval(() => setElapsed(Date.now() - startedAt), 10_000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [startedAt]);
  const mins = Math.floor(elapsed / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

type MakeStartableState =
  | { kind: "loading" }
  | { kind: "done"; suggestionId: string; suggestion: MakeStartableResult }
  | { kind: "error"; message: string }
  | null;

export function ActiveSession({ session, task, todayTasks, onMarkDone, onEnd, onSwitch }: Props) {
  const [switchOpen, setSwitchOpen] = useState(false);
  const [stuckSessionId, setStuckSessionId] = useState<string | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [msState, setMsState] = useState<MakeStartableState>(null);
  const elapsed = useElapsed(session.started_at);

  useEffect(() => {
    void window.calmly.ai.getSettings().then((s) => setAiEnabled(s.enabled)).catch(() => {});
  }, []);

  const handleMakeStartable = useCallback(async () => {
    if (!task) return;
    setMsState({ kind: "loading" });
    try {
      const r = await window.calmly.ai.run("make_startable", { title: task.title, notes: task.notes ?? "" }, "task", task.id);
      if (!r.ok) {
        setMsState({ kind: "error", message: r.error.kind === "auth" ? "API key missing." : "AI error — try again." });
        return;
      }
      setMsState({ kind: "done", suggestionId: r.value.suggestionId, suggestion: r.value.result as MakeStartableResult });
    } catch {
      setMsState({ kind: "error", message: "Something went wrong." });
    }
  }, [task]);

  const handleApply = useCallback(async (result: MakeStartableResult, suggestionId: string, edited: boolean) => {
    await window.calmly.ai.recordOutcome(suggestionId, edited ? "edited" : "accepted", edited ? result : undefined);
    setMsState(null);
  }, []);

  const handleReject = useCallback(async (suggestionId: string) => {
    await window.calmly.ai.recordOutcome(suggestionId, "rejected");
    setMsState(null);
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <section
      aria-label="Active focus session"
      className="flex flex-col items-center justify-center flex-1 px-8 py-16 gap-8 animate-in fade-in duration-400"
    >
      {/* Soft-time pill */}
      <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium tabular-nums">
        {elapsed} focused
      </span>

      {/* Task title hero */}
      <div className="text-center max-w-xl">
        <h1 className="font-serif italic text-4xl tracking-tight text-stone-800 leading-tight">
          {task?.title ?? "Unknown task"}
        </h1>
        {task?.notes && (
          <p className="mt-3 text-sm text-stone-400 leading-relaxed line-clamp-3">{task.notes}</p>
        )}
      </div>

      {/* Primary action */}
      <button
        onClick={() => void run(onMarkDone)}
        disabled={busy}
        aria-label="Mark done"
        className="inline-flex items-center gap-2 px-8 py-3.5 rounded-[2rem] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold tracking-wide transition-colors shadow-md"
      >
        <CheckCircle2 className="w-4 h-4" />
        Mark done
      </button>

      {/* Secondary actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSwitchOpen(true)}
          disabled={busy}
          aria-label="Switch task"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50 text-xs font-medium transition-colors"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          Switch task
        </button>
        <button
          onClick={async () => {
            const r = await window.calmly.focus.startStuck();
            if (r.ok) setStuckSessionId(r.stuckSessionId);
          }}
          disabled={busy}
          aria-label="I'm stuck"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50 text-xs font-medium transition-colors"
        >
          <AlertCircle className="w-3.5 h-3.5" />
          I'm stuck
        </button>
        <button
          onClick={() => void run(onEnd)}
          disabled={busy}
          aria-label="End focus"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50 text-xs font-medium transition-colors"
        >
          <Square className="w-3.5 h-3.5" />
          End focus
        </button>
        <button
          onClick={() => setReplanOpen(true)}
          disabled={busy}
          aria-label="Replan day"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-50 text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Replan
        </button>
        {aiEnabled && task && (
          <button
            onClick={() => void handleMakeStartable()}
            disabled={busy || msState?.kind === "loading"}
            aria-label="Make Startable"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl border border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Make Startable
          </button>
        )}
      </div>

      {switchOpen && (
        <SwitchTaskPicker
          tasks={todayTasks}
          currentTaskId={session.task_id}
          onPick={(taskId) => { setSwitchOpen(false); void run(() => onSwitch(taskId)); }}
          onClose={() => setSwitchOpen(false)}
        />
      )}

      <ReplanModal open={replanOpen} onClose={() => setReplanOpen(false)} />

      {msState && task && (
        <MakeStartableModal
          taskId={task.id}
          taskTitle={task.title}
          taskNotes={task.notes}
          state={msState}
          onClose={() => setMsState(null)}
          onApply={handleApply}
          onReject={handleReject}
        />
      )}

      {stuckSessionId && (
        <StuckPrompts
          stuckSessionId={stuckSessionId}
          onContinue={() => setStuckSessionId(null)}
          onSwitch={() => { setStuckSessionId(null); setSwitchOpen(true); }}
          onBreak={() => { setStuckSessionId(null); void run(onEnd); }}
          onClose={() => setStuckSessionId(null)}
        />
      )}
    </section>
  );
}
