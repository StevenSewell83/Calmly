import { CalendarDays, CheckCircle2, Clock } from "lucide-react";
import { formatClockParts } from "../../utils/time";
import type { TodayListItem } from "./useTodaySummary";

interface Props {
  items: TodayListItem[];
}

// Chronological list of the day. Read-only here; full editing lives in
// Plan. In-progress tasks get a subtle emerald rail so the eye lands
// on them when scanning a long list.
export function TodayList({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="rounded-[1.8rem] border border-dashed border-stone-200 bg-white/30 px-6 py-8 text-center">
        <p className="text-sm text-stone-400 font-light">Today is clear.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={`${item.kind}:${item.kind === "task" ? item.task.id : item.event.id}`}>
          <Row item={item} />
        </li>
      ))}
    </ul>
  );
}

function Row({ item }: { item: TodayListItem }) {
  if (item.kind === "task") {
    const inProgress = item.task.status === "in_progress";
    return (
      <div
        className={[
          "flex items-center gap-4 rounded-[1.6rem] bg-white px-5 py-4 border transition-colors",
          inProgress
            ? "border-emerald-200 ring-1 ring-emerald-50"
            : "border-stone-200/60",
        ].join(" ")}
      >
        <TimePill at={item.at} optional={item.task.due_at === null} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-800 font-medium truncate">
            {item.task.title}
          </p>
        </div>
        {inProgress ? (
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold tracking-[0.18em] uppercase"
            aria-label="In progress"
          >
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            In progress
          </span>
        ) : (
          <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-stone-400">
            Task
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 rounded-[1.6rem] bg-white px-5 py-4 border border-stone-200/60">
      <TimePill at={item.at} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-800 font-medium truncate">
          {item.event.title}
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] uppercase text-stone-500">
        <CalendarDays className="w-3 h-3" aria-hidden="true" />
        Event
      </span>
    </div>
  );
}

interface TimePillProps {
  at: number;
  // Tasks without a due_at land in the list keyed off updated_at; show a
  // soft "—" so it's clear there's no time anchor rather than misleading
  // the user with the updated_at clock.
  optional?: boolean;
}

function TimePill({ at, optional }: TimePillProps) {
  if (optional) {
    return (
      <span className="w-16 shrink-0 inline-flex items-center justify-center px-2 py-1.5 rounded-xl bg-stone-50 text-stone-300 text-xs font-medium tabular-nums">
        —
      </span>
    );
  }
  const { hm, meridiem } = formatClockParts(at);
  return (
    <span className="w-16 shrink-0 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-xl bg-stone-100 text-stone-700 text-xs font-medium tabular-nums">
      <Clock className="w-3 h-3 text-stone-400" aria-hidden="true" />
      {hm}
      <span className="text-stone-400 text-[9px]">{meridiem}</span>
    </span>
  );
}
