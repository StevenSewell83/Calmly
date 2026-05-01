import { useState, useEffect, useCallback } from "react";
import { Sparkles, X, Check, Pencil, CheckCircle2, Loader2 } from "lucide-react";
import { AIFailureBanner } from "./AIFailureBanner";
import type { AIError } from "../../../../preload/api-types";

export type MakeStartableResult = {
  firstStep: string;
  steps: string[];
};

type ModalState =
  | { kind: "loading" }
  | { kind: "done"; suggestionId: string; suggestion: MakeStartableResult }
  | { kind: "error"; error: AIError };

interface MakeStartableModalProps {
  taskId: string;
  taskTitle: string;
  taskNotes?: string | null;
  state: ModalState;
  onClose: () => void;
  onApply: (result: MakeStartableResult, suggestionId: string, edited: boolean) => Promise<void>;
  onReject: (suggestionId: string) => Promise<void>;
}

export function MakeStartableModal({
  taskTitle,
  state,
  onClose,
  onApply,
  onReject,
}: MakeStartableModalProps) {
  const [editedFirstStep, setEditedFirstStep] = useState<string | null>(null);
  const [editedSteps, setEditedSteps] = useState<string[] | null>(null);
  const [applying, setApplying] = useState(false);

  const suggestion = state.kind === "done" ? state.suggestion : null;
  const suggestionId = state.kind === "done" ? state.suggestionId : null;

  const firstStep = editedFirstStep ?? suggestion?.firstStep ?? "";
  const steps = editedSteps ?? suggestion?.steps ?? [];

  const wasEdited = editedFirstStep !== null || editedSteps !== null;

  const handleApply = useCallback(async () => {
    if (!suggestionId || !suggestion) return;
    setApplying(true);
    await onApply({ firstStep, steps }, suggestionId, wasEdited);
    setApplying(false);
  }, [suggestionId, suggestion, firstStep, steps, wasEdited, onApply]);

  const handleReject = useCallback(async () => {
    if (!suggestionId) return onClose();
    await onReject(suggestionId);
  }, [suggestionId, onReject, onClose]);

  // Keyboard: Enter = apply, Esc = close, R = reject
  useEffect(() => {
    if (state.kind !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Enter") { e.preventDefault(); void handleApply(); }
      else if (e.key === "Escape") onClose();
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); void handleReject(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind, handleApply, handleReject, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Make Startable"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white rounded-[2rem] shadow-xl border border-stone-100 p-6 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Sparkles size={14} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-emerald-600 block">
              Make Startable
            </span>
            <p className="text-sm font-medium text-stone-700 truncate">{taskTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Loading */}
        {state.kind === "loading" && (
          <div className="flex items-center gap-3 py-4">
            <Loader2 size={15} className="text-emerald-500 animate-spin" />
            <span className="text-sm text-stone-500">Finding the first step…</span>
          </div>
        )}

        {/* Error */}
        {state.kind === "error" && (
          <AIFailureBanner
            error={state.error}
            onDismiss={onClose}
          />
        )}

        {/* Result */}
        {state.kind === "done" && (
          <div className="flex flex-col gap-3">
            {/* First step */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3">
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-emerald-600 block mb-1.5">
                First step
              </span>
              <InlineEdit
                value={firstStep}
                onChange={setEditedFirstStep}
                placeholder="What's the first concrete action?"
              />
            </div>

            {/* Optional sub-steps */}
            {steps.length > 0 && (
              <div className="rounded-2xl border border-stone-200 bg-stone-50/50 px-4 py-3">
                <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-stone-400 block mb-2">
                  Then
                </span>
                <ul className="flex flex-col gap-1.5">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="text-[9px] text-stone-300 font-bold tabular-nums">{i + 2}</span>
                      <InlineEdit
                        value={(editedSteps ?? steps)[i] ?? step}
                        onChange={(v) => {
                          const next = [...(editedSteps ?? steps)];
                          next[i] = v;
                          setEditedSteps(next);
                        }}
                        placeholder={`Step ${i + 2}`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-1">
              <button
                type="button"
                onClick={() => void handleApply()}
                disabled={applying || !firstStep.trim()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors"
              >
                {applying ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Apply
              </button>
              <button
                type="button"
                onClick={() => void handleReject()}
                disabled={applying}
                className="px-4 py-2.5 rounded-2xl text-sm text-stone-500 hover:bg-stone-100 transition-colors disabled:opacity-40"
              >
                Discard
              </button>
              <span className="ml-auto text-[10px] text-stone-400">
                Enter · R discard
              </span>
            </div>
            {wasEdited && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-600">
                <Check size={10} />
                Edited — will be recorded
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface InlineEditProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function InlineEdit({ value, onChange, placeholder }: InlineEditProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(false); } }}
        placeholder={placeholder}
        className="w-full text-sm text-stone-800 bg-transparent outline-none border-b border-emerald-300 pb-0.5"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1.5 w-full text-left"
    >
      <span className="text-sm text-stone-800 flex-1">
        {value || <span className="text-stone-400 italic">{placeholder}</span>}
      </span>
      <Pencil size={11} className="text-stone-300 group-hover:text-stone-500 shrink-0 transition-colors" />
    </button>
  );
}
