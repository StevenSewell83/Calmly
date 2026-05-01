import { useState } from "react";
import { CalendarDays, MoveRight, Inbox, X } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";

const PUSH_PRESETS: { label: string; ms: number }[] = [
  { label: "+30m", ms: 30 * 60_000 },
  { label: "+1h", ms: 60 * 60_000 },
  { label: "+4h", ms: 4 * 60 * 60_000 },
  { label: "+1d", ms: 24 * 60 * 60_000 },
];

interface Props {
  task: PlanTaskItem;
  onSaved(): Promise<void>;
}

export function RescheduleControls({ task, onSaved }: Props) {
  const [targetDate, setTargetDate] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<{ ok: boolean }>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.ok) await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const handleMoveToDate = () => {
    if (!targetDate) return;
    const targetDayMs = new Date(targetDate + "T12:00:00").getTime();
    void run(() => window.calmly.plan.moveToDate({ taskId: task.id, targetDayMs }));
    setTargetDate("");
  };

  return (
    <section className="space-y-3 pt-2 border-t border-stone-100">
      <p className="text-xs font-medium text-stone-500 uppercase tracking-wide">Reschedule</p>

      {/* Move to date */}
      <div className="flex gap-2 items-center">
        <CalendarDays className="w-4 h-4 text-stone-400 shrink-0" />
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="flex-1 text-sm rounded-lg border border-stone-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-300"
          aria-label="Move to date"
        />
        <button
          onClick={handleMoveToDate}
          disabled={!targetDate || busy}
          className="text-xs px-3 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 disabled:opacity-40"
        >
          Move
        </button>
      </div>

      {/* Push by presets */}
      {task.scheduled_start !== null && (
        <div className="flex gap-1.5 flex-wrap items-center">
          <MoveRight className="w-4 h-4 text-stone-400 shrink-0" />
          {PUSH_PRESETS.map(({ label, ms }) => (
            <button
              key={label}
              onClick={() => void run(() => window.calmly.plan.pushBy({ taskId: task.id, offsetMs: ms }))}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Move to backlog / drop from today */}
      <div className="flex gap-2">
        <button
          onClick={() => void run(() => window.calmly.plan.toBacklog(task.id))}
          disabled={busy}
          className="flex items-center gap-1 text-xs px-3 py-1 rounded-lg bg-stone-100 hover:bg-stone-200 disabled:opacity-40"
        >
          <Inbox className="w-3 h-3" /> Backlog
        </button>
        <button
          onClick={() => void run(() => window.calmly.plan.dropFromToday(task.id))}
          disabled={busy}
          className="flex items-center gap-1 text-xs px-3 py-1 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 disabled:opacity-40"
        >
          <X className="w-3 h-3" /> Drop
        </button>
      </div>
    </section>
  );
}
