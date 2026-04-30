import { ArrowRight, CalendarDays, Clock } from "lucide-react";
import { formatClock, formatRelativeFuture } from "../../utils/time";
import type { NextItem } from "./useTodaySummary";

interface Props {
  next: NextItem;
  now: number;
}

// Renders the upcoming commitment in a smaller, neutral card. Time
// is shown as both an absolute clock pill and a relative phrase
// ("In 23 minutes") so a user can orient on either reading.
export function NextCard({ next, now }: Props) {
  if (!next) {
    return (
      <article
        aria-label="Next"
        className="rounded-[1.8rem] bg-white/40 border border-stone-200/60 px-6 py-5 flex items-center gap-4"
      >
        <div className="w-10 h-10 rounded-2xl bg-stone-100 text-stone-300 flex items-center justify-center shrink-0">
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-400">
            Next
          </span>
          <p className="mt-1 text-sm text-stone-400 font-light">
            Nothing scheduled next.
          </p>
        </div>
      </article>
    );
  }

  const at = next.kind === "task" ? (next.task.due_at ?? 0) : next.event.start_at;
  const title = next.kind === "task" ? next.task.title : next.event.title;
  const Icon = next.kind === "task" ? Clock : CalendarDays;
  const kindLabel = next.kind === "task" ? "Task" : "Event";

  return (
    <article
      aria-label="Next"
      className="rounded-[1.8rem] bg-white border border-stone-200/60 px-6 py-5 flex items-center gap-4"
    >
      <div className="w-10 h-10 rounded-2xl bg-stone-100 text-stone-500 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-400">
          Next · {kindLabel}
        </span>
        <h3 className="mt-1 text-base text-stone-800 font-medium truncate">
          {title}
        </h3>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm text-stone-700 font-medium tabular-nums">
          {formatClock(at)}
        </div>
        <div className="text-[11px] text-stone-400 tracking-wide">
          {formatRelativeFuture(at, now)}
        </div>
      </div>
    </article>
  );
}

// Format an absolute clock label in the user's local zone. Twelve-hour
