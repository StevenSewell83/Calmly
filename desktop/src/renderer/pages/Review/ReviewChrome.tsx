import { Moon, Timer } from "lucide-react";
import { formatDateLabel, formatFocusedMs } from "./reviewFormat";

// Presentational chrome for Review.tsx: the date+focused-ms strip,
// the close-the-day footer, and the per-page loading skeleton. The
// signed-out / error shells live in PageStateView (REFACTOR-AUDIT-4).

export interface SummaryStripProps {
  date: string;
  focusedMs: number;
  alreadyClosed: boolean;
}

export function SummaryStrip({
  date,
  focusedMs,
  alreadyClosed,
}: SummaryStripProps): JSX.Element {
  const focused = formatFocusedMs(focusedMs);
  return (
    <div className="mt-6 inline-flex items-center gap-4 rounded-2xl bg-stone-50/60 border border-stone-200/40 px-4 py-2.5">
      <span className="text-xs text-stone-500 tracking-wide font-medium">
        {formatDateLabel(date)}
      </span>
      <span className="w-1 h-1 rounded-full bg-stone-300" aria-hidden="true" />
      <span className="inline-flex items-center gap-1.5 text-xs text-stone-500 tracking-wide font-medium">
        <Timer className="w-3.5 h-3.5" aria-hidden="true" />
        {focused === null ? "—" : focused}
      </span>
      {alreadyClosed ? (
        <>
          <span
            className="w-1 h-1 rounded-full bg-stone-300"
            aria-hidden="true"
          />
          <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 tracking-wide font-medium">
            <Moon className="w-3.5 h-3.5" aria-hidden="true" />
            Already closed today
          </span>
        </>
      ) : null}
    </div>
  );
}

export interface ShutdownFooterProps {
  committing: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export function ShutdownFooter({
  committing,
  onComplete,
  onSkip,
}: ShutdownFooterProps): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onSkip}
        className="px-5 py-2.5 rounded-2xl text-sm font-medium tracking-wide text-stone-500 hover:bg-stone-100 transition-colors"
      >
        Skip shutdown
      </button>
      <button
        type="button"
        onClick={onComplete}
        disabled={committing}
        className="inline-flex items-center gap-2 px-6 py-2.5 rounded-2xl bg-emerald-600 text-white text-sm font-medium tracking-wide hover:bg-emerald-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
      >
        <Moon className="w-4 h-4" aria-hidden="true" />
        {committing ? "Closing…" : "Complete shutdown"}
      </button>
    </div>
  );
}

export function LoadingShell(): JSX.Element {
  return (
    <div role="status" aria-label="Loading review" className="flex flex-col gap-4">
      <div className="rounded-[1.6rem] bg-stone-100/60 h-16 animate-pulse" />
      <div className="rounded-[1.4rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.4rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.4rem] bg-stone-100/60 h-14 animate-pulse" />
    </div>
  );
}

