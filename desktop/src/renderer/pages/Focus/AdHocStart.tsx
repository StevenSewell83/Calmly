import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { TaskSearchPicker } from "./TaskSearchPicker";

interface Props {
  onStarted(): Promise<void>;
  open: boolean;
}

export function AdHocStart({ onStarted, open }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const handleCapture = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await window.calmly.focus.startAdHoc(text.trim());
      if (!r.ok) {
        setError("Couldn't start — try again.");
        return;
      }
      setText("");
      await onStarted();
    } finally {
      setBusy(false);
    }
  };

  const handlePickExisting = async (taskId: string) => {
    setPickerOpen(false);
    setBusy(true);
    try {
      await window.calmly.focus.start({ taskId, source: "ad-hoc" });
      await onStarted();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-3">
      <p className="text-xs font-medium text-stone-500 uppercase tracking-wide text-center">
        Ad-hoc focus
      </p>

      {/* Capture & focus */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCapture();
          }}
          placeholder="What are you focusing on?"
          disabled={busy}
          aria-label="Ad-hoc focus input"
          className="flex-1 text-sm rounded-2xl border border-stone-200 bg-white px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-300 disabled:opacity-50"
        />
        <button
          onClick={() => void handleCapture()}
          disabled={!text.trim() || busy}
          aria-label="Start focus"
          className="px-3 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500 text-center">
          {error}
        </p>
      )}

      {/* Pick from existing */}
      <button
        onClick={() => setPickerOpen(true)}
        disabled={busy}
        className="w-full flex items-center justify-center gap-1.5 text-xs text-stone-500 hover:text-stone-700 py-1 disabled:opacity-40"
      >
        <Search className="w-3.5 h-3.5" />
        Pick from existing tasks
      </button>

      {pickerOpen && (
        <TaskSearchPicker
          onPick={(taskId) => void handlePickExisting(taskId)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
