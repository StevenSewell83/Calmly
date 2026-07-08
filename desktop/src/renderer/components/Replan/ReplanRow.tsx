import { useState } from "react";
import { Inbox, Clock } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import type { ReplanAction } from "../../../preload/api-types";
import { formatClock } from "../../utils/time";

const PUSH_PRESETS = [
  { label: "+30m", ms: 30 * 60_000 },
  { label: "+1h", ms: 60 * 60_000 },
  { label: "+2h", ms: 2 * 60 * 60_000 },
];

const SHRINK_PRESETS = [
  { label: "15m", ms: 15 * 60_000 },
  { label: "30m", ms: 30 * 60_000 },
];

interface Props {
  task: PlanTaskItem;
  selected: boolean;
  onSelect(v: boolean): void;
  onAction(action: ReplanAction): void;
  busy: boolean;
}

export function ReplanRow({ task, selected, onSelect, onAction, busy }: Props) {
  const [dateInput, setDateInput] = useState("");
  const durationMs =
    task.scheduled_start !== null && task.scheduled_end !== null
      ? task.scheduled_end - task.scheduled_start
      : null;
  const durationMins =
    durationMs !== null ? Math.round(durationMs / 60_000) : null;

  return (
    <li
      className={`flex items-start gap-3 p-3 rounded-2xl border transition-colors ${selected ? "bg-emerald-50 border-emerald-200" : "bg-white border-stone-100"}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
        aria-label={`Select ${task.title}`}
        className="mt-1 accent-emerald-500"
      />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-medium text-stone-800 truncate">
            {task.title}
          </p>
          {task.scheduled_start !== null && (
            <span className="inline-flex items-center gap-1 text-xs text-stone-400 mt-0.5">
              <Clock className="w-3 h-3" />
              {formatClock(task.scheduled_start)}
              {durationMins !== null && <span>· {durationMins}m</span>}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {/* Push */}
          {task.scheduled_start !== null &&
            PUSH_PRESETS.map(({ label, ms }) => (
              <button
                key={label}
                disabled={busy}
                onClick={() =>
                  onAction({ type: "push", taskId: task.id, offsetMs: ms })
                }
                className="text-[10px] px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          {/* Shrink */}
          {task.scheduled_start !== null &&
            durationMins !== null &&
            SHRINK_PRESETS.filter(
              (p) => Math.round(p.ms / 60_000) < durationMins,
            ).map(({ label, ms }) => (
              <button
                key={label}
                disabled={busy}
                onClick={() =>
                  onAction({ type: "shrink", taskId: task.id, durationMs: ms })
                }
                className="text-[10px] px-2 py-0.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 disabled:opacity-40"
              >
                {label}
              </button>
            ))}
          {/* Drop */}
          <button
            disabled={busy}
            onClick={() => onAction({ type: "drop", taskId: task.id })}
            className="text-[10px] px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-rose-50 text-stone-500 hover:text-rose-600 disabled:opacity-40 flex items-center gap-0.5"
          >
            <Inbox className="w-2.5 h-2.5" /> Backlog
          </button>
          {/* Move to date */}
          <input
            type="date"
            value={dateInput}
            onChange={(e) => setDateInput(e.target.value)}
            className="text-[10px] px-2 py-0.5 rounded-lg border border-stone-200 text-stone-600 focus:outline-none"
          />
          {dateInput && (
            <button
              disabled={busy}
              onClick={() => {
                onAction({
                  type: "moveToDate",
                  taskId: task.id,
                  targetDayMs: new Date(dateInput + "T12:00:00").getTime(),
                });
                setDateInput("");
              }}
              className="text-[10px] px-2 py-0.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 disabled:opacity-40"
            >
              Move
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
