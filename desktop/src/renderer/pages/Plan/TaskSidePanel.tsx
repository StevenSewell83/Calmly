import { useEffect, useRef, useState } from "react";
import { X, Trash2 } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { RescheduleControls } from "./RescheduleControls";
import { useEscapeKey } from "../../hooks/useEscapeKey";
import { useReminderRule } from "../../hooks/useReminderRule";
import { ReminderBadge } from "../../components/reminders/ReminderBadge";
import { ReminderRuleEditor } from "../../components/reminders/ReminderRuleEditor";

interface Props {
  task: PlanTaskItem | null;
  day: number;
  onClose(): void;
  onSaved(): Promise<void>;
}

// unix-ms → "YYYY-MM-DD" for <input type="date">
function msToDateStr(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// unix-ms → "YYYY-MM-DDTHH:MM" for <input type="datetime-local">
function msToDatetimeLocal(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${m}`;
}

// "YYYY-MM-DD" → unix-ms at noon local (stable across DST)
function dateStrToMs(s: string): number | null {
  if (!s) return null;
  const [y, mo, da] = s.split("-").map(Number);
  if (y === undefined || mo === undefined || da === undefined) return null;
  const d = new Date(y, mo - 1, da, 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// "YYYY-MM-DDTHH:MM" → unix-ms
function datetimeLocalToMs(s: string): number | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function TaskSidePanel({ task, day, onClose, onSaved }: Props) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [schedStart, setSchedStart] = useState("");
  const [schedEnd, setSchedEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const { state: reminderState } = useReminderRule(task?.id ?? "");

  // Reset form whenever active task changes.
  useEffect(() => {
    if (!task) return;
    setTitle(task.title);
    setNotes(task.notes ?? "");
    setDueAt(msToDateStr(task.due_at));
    setSchedStart(msToDatetimeLocal(task.scheduled_start));
    setSchedEnd(msToDatetimeLocal(task.scheduled_end));
    setError(null);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEscapeKey(onClose, task !== null);

  if (!task) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const startMs = datetimeLocalToMs(schedStart);
      const endMs = datetimeLocalToMs(schedEnd);
      const r = await window.calmly.plan.update({
        taskId: task.id,
        title: title.trim(),
        notes: notes || null,
        dueAt: dateStrToMs(dueAt),
        scheduledStart: startMs,
        scheduledEnd: endMs,
      });
      if (!r.ok) { setError(`Save failed: ${r.error}`); return; }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const handleUnschedule = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await window.calmly.plan.unschedule(task.id);
      if (!r.ok) { setError(`Failed: ${r.error}`); return; }
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const isPlaced = task.scheduled_start !== null;

  return (
    <>
      {/* Backdrop — click to close */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Slide-in panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Edit task"
        className={[
          "fixed right-0 top-0 bottom-0 z-50 w-80 flex flex-col",
          "bg-white/95 backdrop-blur-md border-l border-stone-100 shadow-2xl shadow-stone-900/5",
          "animate-in slide-in-from-right-4 duration-200",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-stone-100">
          <h2 className="flex items-center gap-2 text-xs font-bold tracking-[0.2em] uppercase text-stone-500">
            {isPlaced ? "Placed block" : "Backlog task"}
            {reminderState.kind === "ready" ? (
              <ReminderBadge rule={reminderState.data} />
            ) : null}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="p-1.5 rounded-xl text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={(e) => { void handleSave(e); }}
          className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-4 px-5 py-5"
        >
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sp-title" className="text-[10px] font-semibold tracking-[0.15em] uppercase text-stone-500">
              Title
            </label>
            <input
              ref={titleRef}
              id="sp-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sp-notes" className="text-[10px] font-semibold tracking-[0.15em] uppercase text-stone-500">
              Notes
            </label>
            <textarea
              id="sp-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-800 placeholder-stone-400 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            />
          </div>

          {/* Due date */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sp-due" className="text-[10px] font-semibold tracking-[0.15em] uppercase text-stone-500">
              Due date
            </label>
            <input
              id="sp-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-stone-50/60 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
            />
          </div>

          {/* Scheduled start/end */}
          <div className="flex flex-col gap-3 rounded-2xl bg-stone-50/70 border border-stone-100 p-3">
            <p className="text-[10px] font-semibold tracking-[0.15em] uppercase text-stone-500">
              Scheduled time
            </p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sp-start" className="text-[10px] text-stone-400 tracking-wide">
                Start
              </label>
              <input
                id="sp-start"
                type="datetime-local"
                value={schedStart}
                onChange={(e) => setSchedStart(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white/80 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sp-end" className="text-[10px] text-stone-400 tracking-wide">
                End
              </label>
              <input
                id="sp-end"
                type="datetime-local"
                value={schedEnd}
                onChange={(e) => setSchedEnd(e.target.value)}
                className="w-full rounded-xl border border-stone-200 bg-white/80 px-3 py-2 text-sm text-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition"
              />
            </div>
            <p className="text-[10px] text-stone-400 leading-relaxed">
              Clear both fields to return the task to the backlog.
            </p>
          </div>

          {/* Reminder rule (RM-01b) */}
          <ReminderRuleEditor taskId={task.id} />

          {error ? (
            <p role="alert" className="text-xs text-red-500 font-medium px-1">{error}</p>
          ) : null}
        </form>

        {/* Reschedule controls */}
        <div className="px-5 pb-2">
          <RescheduleControls task={task} onSaved={onSaved} />
        </div>

        {/* Footer actions */}
        <div className="flex flex-col gap-2 px-5 pb-5 pt-3 border-t border-stone-100">
          <button
            type="submit"
            form="sp-form"
            onClick={(e) => { void handleSave(e); }}
            disabled={saving}
            className="w-full py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-semibold tracking-wide transition-colors"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {isPlaced ? (
            <button
              type="button"
              onClick={() => { void handleUnschedule(); }}
              disabled={saving}
              className="w-full py-2 rounded-2xl border border-stone-200 text-stone-500 hover:border-red-200 hover:text-red-500 disabled:opacity-50 text-xs font-medium tracking-wide flex items-center justify-center gap-2 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              Remove from grid
            </button>
          ) : null}
        </div>
      </aside>
    </>
  );
}
