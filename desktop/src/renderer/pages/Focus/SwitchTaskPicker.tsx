import { useEffect, useRef } from "react";
import { ArrowRight, X } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatScheduledWindow } from "./focusUtils";

interface Props {
  open: boolean;
  // Pre-filtered list of switchable tasks. Currently-focused task
  // already removed by the parent so we don't need to know it here.
  tasks: PlanTaskItem[];
  onPick: (task: PlanTaskItem) => void;
  onClose: () => void;
}

// CL-09b switch-task panel. Slides in from the right; Escape and
// click-outside-of-panel both close. Mirrors the SnoozeControl
// keyboard pattern from InboxRow so users get the same instincts.
export function SwitchTaskPicker({
  open,
  tasks,
  onPick,
  onClose,
}: Props): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent): void => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    // Defer mousedown binding by a tick so the click that opened the
    // panel doesn't immediately close it.
    const tid = setTimeout(
      () => window.addEventListener("mousedown", onDown),
      0,
    );
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      clearTimeout(tid);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Switch task"
      className="fixed inset-0 z-30 bg-stone-900/10 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        ref={panelRef}
        className="absolute right-0 top-0 bottom-0 w-[28rem] max-w-[90vw] bg-white border-l border-stone-200 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
      >
        <header className="px-6 py-5 flex items-center justify-between border-b border-stone-100">
          <div>
            <h2 className="text-base font-medium text-stone-800">
              Switch task
            </h2>
            <p className="mt-0.5 text-xs text-stone-400 tracking-wide">
              Today&rsquo;s remaining items
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-2xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tasks.length === 0 ? (
            <p className="text-sm text-stone-500 font-light">
              Nothing else queued for today.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((t) => (
                <PickerRow key={t.id} task={t} onPick={onPick} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  task: PlanTaskItem;
  onPick: (task: PlanTaskItem) => void;
}

function PickerRow({ task, onPick }: RowProps): JSX.Element {
  const window = formatScheduledWindow(task.scheduled_start, task.scheduled_end);
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(task)}
        className="group w-full text-left rounded-[1.4rem] bg-white border border-stone-200/60 px-5 py-4 hover:border-emerald-300 hover:shadow-sm transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-stone-800 leading-relaxed line-clamp-1">
              {task.title}
            </p>
            {window ? (
              <p className="mt-1 text-[10px] tracking-[0.18em] uppercase text-stone-400 font-bold">
                {window}
              </p>
            ) : null}
          </div>
          <ArrowRight
            className="w-4 h-4 text-stone-400 group-hover:text-emerald-600 transition-colors shrink-0"
            aria-hidden="true"
          />
        </div>
      </button>
    </li>
  );
}
