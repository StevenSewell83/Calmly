import { useEffect } from "react";
import { X } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatClock } from "../../utils/time";

interface Props {
  tasks: PlanTaskItem[];
  currentTaskId: string;
  onPick(taskId: string): void;
  onClose(): void;
}

export function SwitchTaskPicker({ tasks, currentTaskId, onPick, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const available = tasks.filter((t) => t.id !== currentTaskId);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/10 z-40" />
      <aside
        aria-label="Switch task"
        className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-4 duration-250"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-100">
          <h3 className="text-sm font-semibold text-stone-800">Switch task</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {available.length === 0 ? (
            <li className="py-8 text-center text-sm text-stone-400">No other tasks today.</li>
          ) : available.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onPick(t.id)}
                className="w-full text-left px-4 py-3 rounded-2xl hover:bg-stone-50 transition-colors group"
              >
                <p className="text-sm font-medium text-stone-800 group-hover:text-emerald-700 truncate">{t.title}</p>
                {t.scheduledStart !== null && (
                  <p className="text-xs text-stone-400 mt-0.5">{formatClock(t.scheduledStart)}</p>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
