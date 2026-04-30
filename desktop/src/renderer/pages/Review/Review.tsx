import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, Inbox, CalendarDays, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { ReviewSummary, ReviewTaskItem } from "../../../preload/api-types";
import { EmptyState } from "../../components/EmptyState";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtFocused(ms: number): string {
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m focused`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m focused`;
}

function fmtDateHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m as number) - 1, d as number).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric",
  });
}

const MAX_REFLECTION = 280;

// ── types ─────────────────────────────────────────────────────────────────────

type RowAction = "carry" | "drop" | "done" | "move";

interface UnfinishedRowState {
  task: ReviewTaskItem;
  action: RowAction | null;
  dateInput: string;
  busy: boolean;
}

// ── main component ────────────────────────────────────────────────────────────

export function Review() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [rows, setRows] = useState<UnfinishedRowState[]>([]);
  const [reflection, setReflection] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const reflectionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void window.calmly.review.summary().then((r) => {
      setLoading(false);
      if (!r.ok) { setError("Not signed in."); return; }
      setSummary(r.summary);
      setRows(r.summary.unfinished.map((t) => ({ task: t, action: null, dateInput: "", busy: false })));
    });
  }, []);

  async function applyAction(idx: number, action: RowAction) {
    const row = rows[idx];
    if (!row || row.busy) return;
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, busy: true } : r));
    const { task } = row;
    if (action === "carry") {
      await window.calmly.review.carryForward([task.id]);
    } else if (action === "drop") {
      await window.calmly.review.drop([task.id]);
    } else if (action === "done") {
      await window.calmly.review.markDone([task.id]);
    } else if (action === "move" && row.dateInput) {
      const d = new Date(row.dateInput + "T12:00:00");
      await window.calmly.review.moveTo(task.id, d.getTime());
    }
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, action, busy: false } : r));
  }

  async function handleComplete() {
    setCompleting(true);
    await window.calmly.review.completeShutdown(reflection.trim() || null);
    navigate("/");
  }

  async function handleSkip() {
    navigate("/");
  }

  if (loading) {
    return (
      <section className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-stone-200 border-t-emerald-500 animate-spin" />
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="flex-1 flex items-center justify-center">
        <p className="text-sm text-stone-400">{error ?? "Could not load review."}</p>
      </section>
    );
  }

  const allActioned = rows.every((r) => r.action !== null);

  return (
    <section
      aria-label="Daily shutdown review"
      className="flex-1 px-12 pt-10 pb-24 max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      {/* Header */}
      <header className="mb-10">
        <p className="text-xs text-stone-400 tracking-widest uppercase mb-2">{fmtDateHeader(summary.dateStr)}</p>
        <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">Close the day.</h1>
        <p className="mt-2 text-sm text-stone-400">{fmtFocused(summary.focusedMs)}</p>
      </header>

      {/* Completed section */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-500">
            Completed today
          </h2>
        </div>
        {summary.completed.length === 0 ? (
          <div className="pl-6">
            <EmptyState
              name="review-no-completed"
              title="Some days are heavy. That's okay."
              body="You can still close out the day."
            />
          </div>
        ) : (
          <>
            <p className="text-2xl font-serif italic text-emerald-700 mb-3 pl-6">
              {summary.completed.length} {summary.completed.length === 1 ? "thing" : "things"} done.
            </p>
            <ul className="pl-6 space-y-1">
              {summary.completed.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm text-stone-500">
                  <span className="w-1 h-1 rounded-full bg-emerald-400 flex-shrink-0" />
                  <span className="truncate">{t.title}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Unfinished section */}
      {rows.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-4 h-4 flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-sm border-2 border-stone-300" />
            </span>
            <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-500">
              Unfinished — what to do?
            </h2>
          </div>
          <ul className="space-y-2">
            {rows.map((row, idx) => (
              <UnfinishedRow
                key={row.task.id}
                row={row}
                onAction={(a) => void applyAction(idx, a)}
                onDateChange={(v) => setRows((prev) => prev.map((r, i) => i === idx ? { ...r, dateInput: v } : r))}
              />
            ))}
          </ul>
        </div>
      )}

      {/* Reflection */}
      <div className="mb-10">
        <h2 className="text-xs font-bold tracking-[0.2em] uppercase text-stone-500 mb-3">
          Reflection <span className="font-normal text-stone-300 tracking-normal normal-case">(optional)</span>
        </h2>
        <div className="relative">
          <textarea
            ref={reflectionRef}
            value={reflection}
            onChange={(e) => setReflection(e.target.value.slice(0, MAX_REFLECTION))}
            placeholder="One word, one sentence, or nothing at all…"
            rows={2}
            className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 placeholder:text-stone-300 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:bg-white transition-colors"
          />
          {reflection.length > 0 && (
            <span className="absolute bottom-2.5 right-3 text-[10px] text-stone-300 tabular-nums">
              {MAX_REFLECTION - reflection.length}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => void handleComplete()}
          disabled={completing}
          className="w-full py-3 rounded-[2rem] bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-sm tracking-wide transition-colors shadow-md flex items-center justify-center gap-2"
        >
          <CheckCheck className="w-4 h-4" />
          Complete shutdown
          {!allActioned && rows.length > 0 && (
            <span className="ml-1 text-emerald-200 font-normal text-xs">
              ({rows.filter((r) => r.action === null).length} unactioned)
            </span>
          )}
        </button>
        <button
          onClick={() => void handleSkip()}
          className="w-full py-2 rounded-[2rem] text-xs text-stone-400 hover:text-stone-600 transition-colors"
        >
          Skip shutdown
        </button>
      </div>
    </section>
  );
}

// ── UnfinishedRow ─────────────────────────────────────────────────────────────

interface UnfinishedRowProps {
  row: UnfinishedRowState;
  onAction(a: RowAction): void;
  onDateChange(v: string): void;
}

function UnfinishedRow({ row, onAction, onDateChange }: UnfinishedRowProps) {
  const { task, action, dateInput, busy } = row;
  const done = action !== null;

  return (
    <li className={`rounded-2xl border px-4 py-3 transition-colors ${done ? "bg-stone-50 border-stone-100 opacity-60" : "bg-white border-stone-100"}`}>
      <p className={`text-sm font-medium mb-2 truncate ${done ? "line-through text-stone-400" : "text-stone-800"}`}>
        {task.title}
      </p>
      {!done && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <button
            disabled={busy}
            onClick={() => onAction("carry")}
            className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="w-3 h-3" />
            Carry forward
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("drop")}
            className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-xl bg-stone-100 hover:bg-rose-50 text-stone-500 hover:text-rose-600 disabled:opacity-40 transition-colors"
          >
            <Inbox className="w-3 h-3" />
            Drop
          </button>
          <button
            disabled={busy}
            onClick={() => onAction("done")}
            className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-xl bg-stone-100 hover:bg-emerald-50 text-stone-500 hover:text-emerald-700 disabled:opacity-40 transition-colors"
          >
            <CheckCircle2 className="w-3 h-3" />
            Mark done
          </button>
          <div className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3 text-stone-300" />
            <input
              type="date"
              value={dateInput}
              onChange={(e) => onDateChange(e.target.value)}
              className="text-[10px] px-2 py-1 rounded-xl border border-stone-200 text-stone-600 focus:outline-none focus:ring-1 focus:ring-emerald-300"
            />
            {dateInput && (
              <button
                disabled={busy}
                onClick={() => onAction("move")}
                className="text-[10px] px-2 py-1 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-600 disabled:opacity-40"
              >
                Move
              </button>
            )}
          </div>
        </div>
      )}
      {done && (
        <p className="text-[10px] text-stone-400">
          {action === "carry" ? "Carried to tomorrow" : action === "drop" ? "Dropped" : action === "done" ? "Marked done" : "Moved"}
        </p>
      )}
    </li>
  );
}
