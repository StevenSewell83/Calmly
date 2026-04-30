import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { OpenTaskItem } from "../../../preload/api-types";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface Props {
  onPick(taskId: string): void;
  onClose(): void;
}

export function TaskSearchPicker({ onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<OpenTaskItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    void (async () => {
      const r = await window.calmly.focus.searchOpenTasks(query);
      if (r.ok) setTasks(r.tasks);
    })();
  }, [query]);

  useEscapeKey(onClose);

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-black/15 z-40" />
      <aside
        aria-label="Pick a task"
        className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right-4 duration-250"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-100">
          <Search className="w-4 h-4 text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks…"
            className="flex-1 text-sm bg-transparent focus:outline-none text-stone-800 placeholder-stone-400"
          />
          <button onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-stone-400 hover:text-stone-700">
            <X className="w-4 h-4" />
          </button>
        </div>
        <ul className="flex-1 overflow-y-auto p-2 space-y-1">
          {tasks.length === 0 ? (
            <li className="py-8 text-center text-sm text-stone-400">No tasks found.</li>
          ) : tasks.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => onPick(t.id)}
                className="w-full text-left px-4 py-2.5 rounded-2xl hover:bg-stone-50 transition-colors"
              >
                <p className="text-sm font-medium text-stone-800 truncate">{t.title}</p>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </>
  );
}
