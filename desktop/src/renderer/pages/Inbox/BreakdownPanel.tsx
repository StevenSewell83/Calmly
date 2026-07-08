import { useRef, useState, type KeyboardEvent } from "react";
import { Plus, X } from "lucide-react";

interface BreakdownPanelProps {
  rawText: string;
  dueAt: number | null;
  onConfirm: (parentTitle: string, subtasks: string[]) => void;
  onCancel: () => void;
}

export function BreakdownPanel({
  rawText,
  dueAt,
  onConfirm,
  onCancel,
}: BreakdownPanelProps) {
  const [parentTitle, setParentTitle] = useState("");
  const [subtasks, setSubtasks] = useState<string[]>([""]);
  const listRef = useRef<HTMLDivElement>(null);

  function addRow() {
    setSubtasks((prev) => [...prev, ""]);
    requestAnimationFrame(() => {
      const inputs = listRef.current?.querySelectorAll("input");
      inputs?.[inputs.length - 1]?.focus();
    });
  }

  function updateRow(i: number, value: string) {
    setSubtasks((prev) => prev.map((s, idx) => (idx === i ? value : s)));
  }

  function removeRow(i: number) {
    setSubtasks((prev) => {
      const next = prev.filter((_, idx) => idx !== i);
      return next.length === 0 ? [""] : next;
    });
  }

  function handleSubtaskKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      addRow();
    } else if (
      e.key === "Backspace" &&
      subtasks[i] === "" &&
      subtasks.length > 1
    ) {
      e.preventDefault();
      removeRow(i);
      requestAnimationFrame(() => {
        const inputs = listRef.current?.querySelectorAll("input");
        inputs?.[Math.max(0, i - 1)]?.focus();
      });
    }
  }

  function handleConfirm() {
    const trimmed = parentTitle.trim();
    if (!trimmed) return;
    onConfirm(trimmed, subtasks);
  }

  return (
    <div className="mt-6 bg-stone-50 border border-stone-200 rounded-[1.8rem] p-6 flex flex-col gap-4">
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-400 mb-1">
          Original thought
        </p>
        <p className="text-sm text-stone-500 italic">{rawText}</p>
      </div>

      <div>
        <label
          htmlFor="breakdown-parent"
          className="block text-[10px] font-bold tracking-[0.2em] uppercase text-stone-500 mb-2"
        >
          Next action (required)
        </label>
        <input
          id="breakdown-parent"
          type="text"
          autoFocus
          value={parentTitle}
          onChange={(e) => setParentTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleConfirm();
            }
          }}
          placeholder="What's the actual next step?"
          className="w-full px-4 py-2.5 rounded-2xl border border-stone-200 bg-white text-sm text-stone-800 outline-none focus:border-emerald-400 transition-colors"
        />
      </div>

      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-stone-500 mb-2">
          Subtasks (optional)
        </p>
        <div ref={listRef} className="flex flex-col gap-2">
          {subtasks.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={s}
                onChange={(e) => updateRow(i, e.target.value)}
                onKeyDown={(e) => handleSubtaskKey(e, i)}
                placeholder={`Subtask ${i + 1}`}
                className="flex-1 px-4 py-2 rounded-2xl border border-stone-200 bg-white text-sm text-stone-800 outline-none focus:border-emerald-400 transition-colors"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                aria-label={`Remove subtask ${i + 1}`}
                className="text-stone-300 hover:text-stone-500 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addRow}
          className="mt-2 flex items-center gap-1.5 text-xs text-stone-400 hover:text-emerald-600 transition-colors"
        >
          <Plus size={12} />
          Add subtask
        </button>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!parentTitle.trim()}
          className="px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 disabled:opacity-40 transition-colors"
        >
          {subtasks.filter(Boolean).length > 0
            ? `Create ${1 + subtasks.filter(Boolean).length} tasks`
            : "Create task"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 rounded-2xl bg-white border border-stone-200 text-stone-600 text-sm font-medium hover:bg-stone-50 transition-colors"
        >
          Cancel
        </button>
        {dueAt && (
          <span className="text-xs text-stone-400 ml-auto">
            Due: {new Date(dueAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  );
}
