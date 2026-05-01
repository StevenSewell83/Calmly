import { useState, useEffect, useCallback } from "react";
import {
  Sparkles, X, CheckCircle2, Loader2, AlertCircle, ChevronDown, ChevronUp,
} from "lucide-react";

export type SplitItem = {
  title: string;
  notes?: string;
};

type ModalState =
  | { kind: "loading" }
  | { kind: "done"; suggestionId: string; items: SplitItem[] }
  | { kind: "error"; message: string };

interface BrainDumpSplitModalProps {
  state: ModalState;
  onClose: () => void;
  onConfirm: (items: SplitItem[], suggestionId: string) => Promise<void>;
}

const MAX_VISIBLE = 20;

export function BrainDumpSplitModal({ state, onClose, onConfirm }: BrainDumpSplitModalProps) {
  const [checkedMap, setCheckedMap] = useState<Record<number, boolean>>({});
  const [editedTitles, setEditedTitles] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const items = state.kind === "done" ? state.items : [];
  const suggestionId = state.kind === "done" ? state.suggestionId : "";

  // All checked by default when items arrive
  useEffect(() => {
    if (state.kind === "done") {
      const m: Record<number, boolean> = {};
      state.items.forEach((_, i) => { m[i] = true; });
      setCheckedMap(m);
      setEditedTitles({});
      setExpanded({});
    }
  }, [state.kind === "done" ? state.suggestionId : null]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = showAll ? items : items.slice(0, MAX_VISIBLE);
  const checkedCount = Object.values(checkedMap).filter(Boolean).length;

  const handleConfirm = useCallback(async () => {
    if (!suggestionId) return;
    setConfirming(true);
    const selected: SplitItem[] = items
      .map((item, i) => ({ title: editedTitles[i] ?? item.title, notes: item.notes }))
      .filter((_, i) => checkedMap[i]);
    await onConfirm(selected, suggestionId);
    setConfirming(false);
  }, [items, checkedMap, editedTitles, suggestionId, onConfirm]);

  // Keyboard: Enter = confirm, Esc = close
  useEffect(() => {
    if (state.kind !== "done") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Enter") { e.preventDefault(); void handleConfirm(); }
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind, handleConfirm, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Brain-dump split"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-[2rem] shadow-xl border border-stone-100 flex flex-col max-h-[80vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center gap-2 px-6 pt-5 pb-3 border-b border-stone-100 shrink-0">
          <div className="w-7 h-7 rounded-xl bg-emerald-100 flex items-center justify-center">
            <Sparkles size={14} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-emerald-600 block">
              Brain-dump split
            </span>
            <p className="text-sm text-stone-500">
              {state.kind === "done"
                ? `${checkedCount} of ${items.length} items selected`
                : "Splitting…"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-stone-400 hover:text-stone-600 transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {state.kind === "loading" && (
            <div className="flex items-center gap-3 py-6 justify-center">
              <Loader2 size={15} className="text-emerald-500 animate-spin" />
              <span className="text-sm text-stone-500">Splitting your brain dump…</span>
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex items-start gap-2 py-4">
              <AlertCircle size={14} className="text-rose-500 mt-0.5 shrink-0" />
              <p className="text-sm text-rose-600">{state.message}</p>
            </div>
          )}

          {state.kind === "done" && (
            <ul className="flex flex-col gap-2">
              {visible.map((item, i) => (
                <SplitItemRow
                  key={i}
                  index={i}
                  item={item}
                  checked={checkedMap[i] ?? true}
                  editedTitle={editedTitles[i]}
                  isExpanded={expanded[i] ?? false}
                  onCheck={(v) => setCheckedMap((m) => ({ ...m, [i]: v }))}
                  onEdit={(v) => setEditedTitles((m) => ({ ...m, [i]: v }))}
                  onToggleExpand={() => setExpanded((m) => ({ ...m, [i]: !m[i] }))}
                />
              ))}
              {items.length > MAX_VISIBLE && !showAll && (
                <li>
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="text-xs text-stone-400 hover:text-stone-600 underline underline-offset-2 mt-1"
                  >
                    Show {items.length - MAX_VISIBLE} more…
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Footer */}
        {state.kind === "done" && (
          <div className="px-6 py-4 border-t border-stone-100 flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming || checkedCount === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
              {confirming
                ? <Loader2 size={13} className="animate-spin" />
                : <CheckCircle2 size={13} />}
              Create {checkedCount} item{checkedCount !== 1 ? "s" : ""}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={confirming}
              className="px-4 py-2.5 rounded-2xl text-sm text-stone-500 hover:bg-stone-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  index: number;
  item: SplitItem;
  checked: boolean;
  editedTitle?: string;
  isExpanded: boolean;
  onCheck: (v: boolean) => void;
  onEdit: (v: string) => void;
  onToggleExpand: () => void;
}

function SplitItemRow({ item, checked, editedTitle, isExpanded, onCheck, onEdit, onToggleExpand }: RowProps) {
  const [editing, setEditing] = useState(false);
  const title = editedTitle ?? item.title;

  return (
    <li className={[
      "rounded-2xl border px-3 py-2.5 transition-colors",
      checked ? "border-stone-200 bg-white" : "border-stone-100 bg-stone-50 opacity-50",
    ].join(" ")}>
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          className="accent-emerald-600 w-4 h-4 shrink-0"
        />
        {editing ? (
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => onEdit(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setEditing(false); } }}
            className="flex-1 text-sm text-stone-800 bg-transparent outline-none border-b border-emerald-300 pb-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex-1 text-left text-sm text-stone-800 hover:text-emerald-700 truncate"
          >
            {title}
          </button>
        )}
        {item.notes && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-stone-300 hover:text-stone-500 transition-colors shrink-0"
            title={isExpanded ? "Hide preview" : "Show preview"}
          >
            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        )}
      </div>
      {isExpanded && item.notes && (
        <p className="mt-1.5 ml-7 text-xs text-stone-400 leading-relaxed line-clamp-3">
          {item.notes}
        </p>
      )}
    </li>
  );
}
