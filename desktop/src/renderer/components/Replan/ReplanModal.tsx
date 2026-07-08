import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { TaskStatusSchema } from "@calmly/shared";
import type {
  PlanTaskItem,
  ReplanAction,
  ReplanReason,
} from "../../../preload/api-types";
import { ReplanRow } from "./ReplanRow";

const stillActionable = (t: PlanTaskItem) =>
  t.status !== TaskStatusSchema.enum.done &&
  t.status !== TaskStatusSchema.enum.dropped;

const REASONS: { value: ReplanReason; label: string }[] = [
  { value: null, label: "No reason selected" },
  { value: "ran_late", label: "Things ran late" },
  { value: "got_stuck", label: "Got stuck on something" },
  { value: "priorities_changed", label: "Priorities changed" },
  { value: "other", label: "Something else" },
];

interface Props {
  open: boolean;
  onClose(): void;
}

export function ReplanModal({ open, onClose }: Props) {
  const [tasks, setTasks] = useState<PlanTaskItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<ReplanReason>(null);
  const [busy, setBusy] = useState(false);
  const [reasonRecorded, setReasonRecorded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setReason(null);
    setReasonRecorded(false);
    void window.calmly.plan.listForDay().then((r) => {
      if (!r.ok) return;
      setTasks(r.plan.scheduled.filter(stillActionable));
    });
  }, [open]);

  async function handleReasonChange(r: ReplanReason) {
    setReason(r);
    if (r !== null && !reasonRecorded) {
      setReasonRecorded(true);
      await window.calmly.replan.recordEvent(r);
    }
  }

  async function handleAction(action: ReplanAction) {
    setBusy(true);
    await window.calmly.replan.applyBatch([action]);
    const r = await window.calmly.plan.listForDay();
    if (r.ok) {
      setTasks(r.plan.scheduled.filter(stillActionable));
    }
    setBusy(false);
  }

  async function handleApplySelected(type: "push" | "drop") {
    if (selected.size === 0) return;
    const actions: ReplanAction[] = Array.from(selected).map((id) => {
      if (type === "push")
        return { type: "push", taskId: id, offsetMs: 30 * 60_000 };
      return { type: "drop", taskId: id };
    });
    setBusy(true);
    await window.calmly.replan.applyBatch(actions);
    const r = await window.calmly.plan.listForDay();
    if (r.ok) {
      setTasks(r.plan.scheduled.filter(stillActionable));
    }
    setSelected(new Set());
    setBusy(false);
  }

  function toggleSelect(id: string, v: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Replan"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-[2rem] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h2 className="font-serif italic text-2xl text-stone-800">
              Your day shifted.
            </h2>
            <p className="text-xs text-stone-400 mt-0.5">
              Let's adjust without losing your footing.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-stone-100 text-stone-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Reason picker */}
        <div className="px-6 pb-4">
          <select
            value={reason ?? ""}
            onChange={(e) =>
              void handleReasonChange((e.target.value || null) as ReplanReason)
            }
            className="w-full text-xs px-3 py-2 rounded-xl border border-stone-200 text-stone-600 focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-stone-50"
          >
            {REASONS.map(({ value, label }) => (
              <option key={String(value)} value={value ?? ""}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Task list */}
        <ul className="flex-1 overflow-y-auto px-6 pb-2 space-y-2">
          {tasks.length === 0 ? (
            <li className="text-xs text-stone-400 text-center py-8">
              No remaining scheduled tasks for today.
            </li>
          ) : (
            tasks.map((t) => (
              <ReplanRow
                key={t.id}
                task={t}
                selected={selected.has(t.id)}
                onSelect={(v) => toggleSelect(t.id, v)}
                onAction={handleAction}
                busy={busy}
              />
            ))
          )}
        </ul>

        {/* Batch bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 px-6 py-3 bg-emerald-50 border-t border-emerald-100">
            <span className="text-xs text-emerald-700 font-medium flex-1">
              {selected.size} selected
            </span>
            <button
              disabled={busy}
              onClick={() => void handleApplySelected("push")}
              className="text-xs px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 disabled:opacity-40"
            >
              Push +30m
            </button>
            <button
              disabled={busy}
              onClick={() => void handleApplySelected("drop")}
              className="text-xs px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 disabled:opacity-40"
            >
              → Backlog
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-100">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition-colors"
          >
            Done — replanned
          </button>
        </div>
      </div>
    </div>
  );
}
