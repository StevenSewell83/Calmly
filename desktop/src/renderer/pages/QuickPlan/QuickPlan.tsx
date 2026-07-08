import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { QuickPlanRow } from "./QuickPlanRow";
import { formatClock } from "../../utils/time";

interface Props {
  open: boolean;
  onClose(): void;
}

function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function totalScheduledMins(tasks: PlanTaskItem[]): number {
  return tasks.reduce((acc, t) => {
    if (t.scheduled_start !== null && t.scheduled_end !== null) {
      return acc + Math.round((t.scheduled_end - t.scheduled_start) / 60_000);
    }
    return acc;
  }, 0);
}

export function QuickPlan({ open, onClose }: Props) {
  const [tasks, setTasks] = useState<PlanTaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await window.calmly.plan.listForDay();
    if (r.ok) setTasks(r.plan.scheduled);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const handleMove = (index: number, dir: "up" | "down") => {
    const copy = [...tasks];
    const swap = dir === "up" ? index - 1 : index + 1;
    if (swap < 0 || swap >= copy.length) return;
    [copy[index], copy[swap]] = [copy[swap]!, copy[index]!];
    // Reassign scheduled_start/end preserving durations in new order
    const anchors = copy.map((t) =>
      t.scheduled_start !== null && t.scheduled_end !== null
        ? t.scheduled_end - t.scheduled_start
        : 0,
    );
    const sortedStarts = tasks
      .filter((t) => t.scheduled_start !== null)
      .map((t) => t.scheduled_start!)
      .sort((a, b) => a - b);
    const reordered = copy.map((t, i) => ({
      ...t,
      scheduled_start: sortedStarts[i] ?? t.scheduled_start,
      scheduled_end:
        sortedStarts[i] !== undefined && anchors[i] !== undefined
          ? sortedStarts[i]! + anchors[i]!
          : t.scheduled_end,
    }));
    setTasks(reordered);
    void withBusy(async () => {
      const t = reordered[index];
      const t2 = reordered[swap];
      if (t && t.scheduled_start !== null && t.scheduled_end !== null) {
        await window.calmly.plan.schedule({
          taskId: t.id,
          startAt: t.scheduled_start,
          endAt: t.scheduled_end,
        });
      }
      if (t2 && t2.scheduled_start !== null && t2.scheduled_end !== null) {
        await window.calmly.plan.schedule({
          taskId: t2.id,
          startAt: t2.scheduled_start,
          endAt: t2.scheduled_end,
        });
      }
    });
  };

  const handleDrop = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    void withBusy(async () => {
      await window.calmly.plan.toBacklog(taskId);
    });
  };

  const handleShrink = (task: PlanTaskItem, mins: number) => {
    if (task.scheduled_start === null) return;
    const newEnd = task.scheduled_start + mins * 60_000;
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, scheduled_end: newEnd } : t)),
    );
    void withBusy(async () => {
      await window.calmly.plan.schedule({
        taskId: task.id,
        startAt: task.scheduled_start!,
        endAt: newEnd,
      });
    });
  };

  const handleSkip = async () => {
    await window.calmly.quickplan.setDate(todayLocalStr());
    onClose();
  };

  const handleConfirm = async () => {
    await window.calmly.quickplan.setDate(todayLocalStr());
    onClose();
  };

  if (!open) return null;

  const totalMins = totalScheduledMins(tasks);
  const todayStr = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <>
      <div
        ref={backdropRef}
        onClick={onClose}
        className="fixed inset-0 bg-black/20 z-40 animate-in fade-in duration-200"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick Plan"
        className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-lg mx-auto bg-white rounded-[2rem] shadow-2xl z-50 animate-in slide-in-from-bottom-4 fade-in duration-300 overflow-hidden max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-stone-100">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-serif italic text-2xl text-stone-800">
                Quick Plan
              </h2>
              <p className="text-xs text-stone-400 mt-0.5">{todayStr}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {!loading && tasks.length > 0 && (
            <p className="mt-3 text-xs text-stone-500">
              {tasks.length} commitment{tasks.length !== 1 ? "s" : ""} ·{" "}
              {totalMins}m scheduled
            </p>
          )}
        </div>

        {/* Task list */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="h-14 rounded-2xl bg-stone-100 animate-pulse"
                />
              ))}
            </div>
          ) : tasks.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-stone-400">
                Nothing scheduled today — you're clear.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {tasks.map((task, i) => (
                <QuickPlanRow
                  key={task.id}
                  task={task}
                  index={i}
                  total={tasks.length}
                  onMove={(dir) => handleMove(i, dir)}
                  onDrop={() => handleDrop(task.id)}
                  onShrink={(mins) => handleShrink(task, mins)}
                  busy={busy}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-100 flex gap-3">
          <button
            onClick={() => void handleSkip()}
            className="flex-1 py-2 rounded-2xl border border-stone-200 text-stone-500 text-sm hover:bg-stone-50 transition-colors"
          >
            Skip for today
          </button>
          <button
            onClick={() => void handleConfirm()}
            className="flex-1 py-2 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors"
          >
            Confirm day
          </button>
        </div>
      </div>
    </>
  );
}
