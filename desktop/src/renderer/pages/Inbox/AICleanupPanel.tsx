import { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  CheckCircle2,
  X,
  Loader2,
  Check,
  Pencil,
} from "lucide-react";
import type { TriageCleanupResult } from "../../state/aiTriage";
import { AIFailureBanner } from "../../components/ai/AIFailureBanner";
import type { AIError } from "../../../../preload/api-types";

interface AICleanupPanelProps {
  rawText: string;
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; suggestionId: string; suggestion: TriageCleanupResult }
    | { kind: "error"; error: AIError };
  onRun: () => void;
  onCancel: () => void;
  onApplyAll: (suggestion: TriageCleanupResult, suggestionId: string) => Promise<void>;
  onDiscard: (suggestionId: string) => Promise<void>;
  onClose: () => void;
  aiEnabled: boolean;
}

type FieldAccepted = {
  type: boolean;
  title: boolean;
  dueDate: boolean;
  nextAction: boolean;
};

export function AICleanupPanel({
  state,
  onRun,
  onCancel,
  onApplyAll,
  onDiscard,
  onClose,
  aiEnabled,
}: AICleanupPanelProps) {
  const [edited, setEdited] = useState<Partial<TriageCleanupResult>>({});
  const [accepted, setAccepted] = useState<FieldAccepted>({
    type: false,
    title: false,
    dueDate: false,
    nextAction: false,
  });
  const [applying, setApplying] = useState(false);

  // Reset edits when a new suggestion arrives
  useEffect(() => {
    if (state.kind === "done") {
      setEdited({});
      setAccepted({ type: false, title: false, dueDate: false, nextAction: false });
    }
  }, [state.kind === "done" ? state.suggestionId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggestion = state.kind === "done" ? state.suggestion : null;
  const suggestionId = state.kind === "done" ? state.suggestionId : null;

  const merged: TriageCleanupResult | null = suggestion
    ? {
        type: (edited.type ?? suggestion.type),
        title: (edited.title ?? suggestion.title),
        dueDate: edited.dueDate !== undefined ? edited.dueDate : suggestion.dueDate,
        nextAction: edited.nextAction !== undefined ? edited.nextAction : suggestion.nextAction,
      }
    : null;

  const handleApplyAll = useCallback(async () => {
    if (!merged || !suggestionId) return;
    setApplying(true);
    await onApplyAll(merged, suggestionId);
    setApplying(false);
  }, [merged, suggestionId, onApplyAll]);

  const handleDiscard = useCallback(async () => {
    if (!suggestionId) return onClose();
    await onDiscard(suggestionId);
  }, [suggestionId, onDiscard, onClose]);

  // Keyboard: A = apply all, R = discard, Esc = close
  useEffect(() => {
    if (state.kind !== "done") return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (e.key === "a" || e.key === "A") { e.preventDefault(); void handleApplyAll(); }
      else if (e.key === "r" || e.key === "R") { e.preventDefault(); void handleDiscard(); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind, handleApplyAll, handleDiscard, onClose]);

  return (
    <div className="mt-4 rounded-[1.8rem] border border-emerald-200 bg-emerald-50/40 p-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center">
          <Sparkles size={13} className="text-emerald-600" />
        </div>
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-700">
          AI Suggestion
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-stone-400 hover:text-stone-600 transition-colors"
          aria-label="Close AI panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Loading */}
      {state.kind === "idle" && (
        <div className="flex flex-col items-start gap-3">
          <p className="text-xs text-stone-500">
            AI will suggest a type, cleaner title, due date, and first step.
          </p>
          <button
            type="button"
            onClick={onRun}
            disabled={!aiEnabled}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors"
          >
            <Sparkles size={12} />
            Get suggestion
          </button>
        </div>
      )}

      {state.kind === "loading" && (
        <div className="flex items-center gap-3 py-2">
          <Loader2 size={14} className="text-emerald-600 animate-spin" />
          <span className="text-xs text-stone-500">Thinking…</span>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto text-xs text-stone-400 hover:text-stone-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {state.kind === "error" && (
        <AIFailureBanner
          error={state.error}
          onRetry={onRun}
          onDismiss={onClose}
        />
      )}

      {state.kind === "done" && merged && (
        <div className="flex flex-col gap-3">
          {/* Type field */}
          <SuggestionField
            label="Type"
            accepted={accepted.type}
            onAccept={() => setAccepted((a) => ({ ...a, type: true }))}
            onReject={() => setAccepted((a) => ({ ...a, type: false }))}
          >
            <div className="flex gap-2 flex-wrap">
              {(["task", "event", "someday"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setEdited((e) => ({ ...e, type: t }))}
                  className={[
                    "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    merged.type === t
                      ? "bg-emerald-600 text-white"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                  ].join(" ")}
                >
                  {t === "someday" ? "Someday" : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </SuggestionField>

          {/* Title field */}
          <SuggestionField
            label="Title"
            accepted={accepted.title}
            onAccept={() => setAccepted((a) => ({ ...a, title: true }))}
            onReject={() => setAccepted((a) => ({ ...a, title: false }))}
          >
            <EditableText
              value={merged.title}
              onChange={(v) => setEdited((e) => ({ ...e, title: v }))}
            />
          </SuggestionField>

          {/* Due date field */}
          {(merged.dueDate !== undefined) && (
            <SuggestionField
              label="Due"
              accepted={accepted.dueDate}
              onAccept={() => setAccepted((a) => ({ ...a, dueDate: true }))}
              onReject={() => setAccepted((a) => ({ ...a, dueDate: false }))}
            >
              <EditableText
                value={merged.dueDate ?? ""}
                onChange={(v) => setEdited((e) => ({ ...e, dueDate: v }))}
                placeholder="e.g. Friday, May 10"
              />
            </SuggestionField>
          )}

          {/* Next action field */}
          {(merged.nextAction !== undefined) && (
            <SuggestionField
              label="First step"
              accepted={accepted.nextAction}
              onAccept={() => setAccepted((a) => ({ ...a, nextAction: true }))}
              onReject={() => setAccepted((a) => ({ ...a, nextAction: false }))}
            >
              <EditableText
                value={merged.nextAction ?? ""}
                onChange={(v) => setEdited((e) => ({ ...e, nextAction: v }))}
                placeholder="e.g. Open the laptop and…"
              />
            </SuggestionField>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <button
              type="button"
              onClick={() => void handleApplyAll()}
              disabled={applying}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
              {applying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Apply all
            </button>
            <button
              type="button"
              onClick={() => void handleDiscard()}
              disabled={applying}
              className="px-4 py-2 rounded-2xl text-xs font-medium text-stone-500 hover:bg-stone-100 transition-colors disabled:opacity-40"
            >
              Discard
            </button>
            <span className="ml-auto text-[10px] text-stone-400 tracking-wide">
              A apply · R discard
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface SuggestionFieldProps {
  label: string;
  accepted: boolean;
  onAccept: () => void;
  onReject: () => void;
  children: React.ReactNode;
}

function SuggestionField({ label, accepted, onAccept, onReject, children }: SuggestionFieldProps) {
  return (
    <div
      className={[
        "rounded-2xl border px-3 py-2.5 transition-colors",
        accepted ? "border-emerald-300 bg-white" : "border-stone-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-stone-400">
          {label}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title="Accept this field"
            onClick={onAccept}
            className={[
              "w-5 h-5 rounded-full flex items-center justify-center transition-colors",
              accepted
                ? "bg-emerald-500 text-white"
                : "bg-stone-100 text-stone-400 hover:bg-emerald-100 hover:text-emerald-600",
            ].join(" ")}
          >
            <Check size={10} />
          </button>
          <button
            type="button"
            title="Reject this field"
            onClick={onReject}
            className={[
              "w-5 h-5 rounded-full flex items-center justify-center transition-colors",
              !accepted
                ? "bg-stone-100 text-stone-400"
                : "bg-stone-100 text-stone-400 hover:bg-rose-100 hover:text-rose-500",
            ].join(" ")}
          >
            <X size={10} />
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

interface EditableTextProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

function EditableText({ value, onChange, placeholder }: EditableTextProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => { if (e.key === "Enter") setEditing(false); }}
        placeholder={placeholder}
        className="w-full text-xs text-stone-800 bg-transparent outline-none border-b border-emerald-300 pb-0.5"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex items-center gap-1.5 w-full text-left"
    >
      <span className="text-xs text-stone-800">{value || <span className="text-stone-400">{placeholder}</span>}</span>
      <Pencil size={10} className="text-stone-300 group-hover:text-stone-500 transition-colors shrink-0" />
    </button>
  );
}
