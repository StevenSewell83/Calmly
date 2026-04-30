import { ChevronUp, ChevronDown, Inbox, Clock } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatClock } from "../../utils/time";

const SHRINK_PRESETS: { label: string; mins: number }[] = [
  { label: "15m", mins: 15 },
  { label: "30m", mins: 30 },
  { label: "1h", mins: 60 },
];

interface Props {
  task: PlanTaskItem;
  index: number;
  total: number;
  onMove(dir: "up" | "down"): void;
  onDrop(): void;
  onShrink(mins: number): void;
  busy: boolean;
}

export function QuickPlanRow({ task, index, total, onMove, onDrop, onShrink, busy }: Props) {
  const start = task.scheduledStart;
  const end = task.scheduledEnd;
  const durationMs = start !== null && end !== null ? end - start : null;
  const durationMins = durationMs !== null ? Math.round(durationMs / 60_000) : null;

  return (
    <li className="flex items-start gap-3 p-3 rounded-2xl bg-white border border-stone-100 shadow-sm">
      {/* Reorder arrows */}
      <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
        <button
          onClick={() => onMove("up")}
          disabled={busy || index === 0}
          aria-label="Move up"
          className="p-0.5 rounded-md text-stone-400 hover:text-stone-700 disabled:opacity-20"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => onMove("down")}
          disabled={busy || index === total - 1}
          aria-label="Move down"
          className="p-0.5 rounded-md text-stone-400 hover:text-stone-700 disabled:opacity-20"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Task info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-800 truncate">{task.title}</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {start !== null && (
            <span className="inline-flex items-center gap-1 text-xs text-stone-500">
              <Clock className="w-3 h-3" />
              {formatClock(start)}
              {durationMins !== null && (
                <span className="text-stone-400">· {durationMins}m</span>
              )}
            </span>
          )}
          {/* Shrink presets */}
          {start !== null && durationMins !== null && (
            <span className="flex gap-1">
              {SHRINK_PRESETS.filter((p) => p.mins < durationMins).map(({ label, mins }) => (
                <button
                  key={label}
                  onClick={() => onShrink(mins)}
                  disabled={busy}
                  className="text-[10px] px-1.5 py-0.5 rounded-md bg-stone-100 hover:bg-stone-200 text-stone-600 disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </span>
          )}
        </div>
      </div>

      {/* Drop button */}
      <button
        onClick={onDrop}
        disabled={busy}
        aria-label={`Drop ${task.title}`}
        className="shrink-0 p-1.5 rounded-xl text-stone-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-40 transition-colors"
      >
        <Inbox className="w-4 h-4" />
      </button>
    </li>
  );
}
