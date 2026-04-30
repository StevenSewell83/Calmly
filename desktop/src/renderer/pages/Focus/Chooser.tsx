import { ArrowRight, CalendarClock, Inbox } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { formatScheduledWindow } from "./focusUtils";

interface Props {
  scheduled: PlanTaskItem[];
  backlog: PlanTaskItem[];
  onPick: (task: PlanTaskItem) => void;
}

// CL-09b empty-state picker. Shown when there's no active session.
// Two columns mirror the Plan page: scheduled (placed time blocks) on
// the left, backlog (open tasks due today, unplaced) on the right.
// Either side empty → render a soft empty state, not a missing column.
export function Chooser({ scheduled, backlog, onPick }: Props): JSX.Element {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-4xl">
      <ChooserColumn
        title="Scheduled today"
        icon={<CalendarClock className="w-3.5 h-3.5" aria-hidden="true" />}
        empty="No time blocks placed for today."
        items={scheduled}
        onPick={onPick}
      />
      <ChooserColumn
        title="Backlog"
        icon={<Inbox className="w-3.5 h-3.5" aria-hidden="true" />}
        empty="Backlog clear."
        items={backlog}
        onPick={onPick}
      />
    </div>
  );
}

interface ColumnProps {
  title: string;
  icon: JSX.Element;
  empty: string;
  items: PlanTaskItem[];
  onPick: (task: PlanTaskItem) => void;
}

function ChooserColumn({
  title,
  icon,
  empty,
  items,
  onPick,
}: ColumnProps): JSX.Element {
  return (
    <section>
      <header className="mb-4 flex items-center gap-2 text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500">
        <span className="w-1 h-1 rounded-full bg-stone-400" />
        {icon}
        {title}
      </header>
      {items.length === 0 ? (
        <div className="rounded-[1.4rem] border border-dashed border-stone-200 bg-white/30 px-6 py-8 text-center">
          <p className="text-xs text-stone-500 font-light">{empty}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <ChooserRow key={item.id} item={item} onPick={onPick} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface RowProps {
  item: PlanTaskItem;
  onPick: (task: PlanTaskItem) => void;
}

function ChooserRow({ item, onPick }: RowProps): JSX.Element {
  const window = formatScheduledWindow(item.scheduled_start, item.scheduled_end);
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(item)}
        className="group w-full text-left rounded-[1.4rem] bg-white border border-stone-200/60 px-5 py-4 hover:border-emerald-300 hover:shadow-sm transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-stone-800 leading-relaxed line-clamp-1">
              {item.title}
            </p>
            {window ? (
              <p className="mt-1 text-[10px] tracking-[0.18em] uppercase text-stone-400 font-bold">
                {window}
              </p>
            ) : null}
          </div>
          <ArrowRight
            className="w-4 h-4 text-stone-400 group-hover:text-emerald-600 transition-colors shrink-0"
            aria-hidden="true"
          />
        </div>
      </button>
    </li>
  );
}
