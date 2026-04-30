import { CheckCircle2 } from "lucide-react";
import type { ReviewTaskItem } from "../../../preload/api-types";

interface Props {
  items: ReviewTaskItem[];
}

// Read-only completed-today list. Lead with the count because this is
// the part of Daily Shutdown that's about acknowledging the day —
// the actionable work lives in Unfinished below.
export function CompletedList({ items }: Props): JSX.Element {
  const count = items.length;
  return (
    <section aria-labelledby="review-completed-heading">
      <header className="mb-4 flex items-baseline gap-3">
        <h2
          id="review-completed-heading"
          className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 flex items-center gap-2"
        >
          <span className="w-1 h-1 rounded-full bg-stone-400" />
          Completed today
        </h2>
        <p className="text-sm text-stone-500">
          {count === 0
            ? "Nothing closed yet."
            : count === 1
              ? "You completed 1 thing today."
              : `You completed ${count} things today.`}
        </p>
      </header>
      {count === 0 ? null : (
        <ul className="flex flex-col gap-1.5" aria-label="Completed tasks">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 px-4 py-2.5 rounded-2xl bg-stone-50/60 border border-stone-200/40"
            >
              <CheckCircle2
                className="w-4 h-4 mt-0.5 text-emerald-500 shrink-0"
                aria-hidden="true"
              />
              <span className="text-sm text-stone-700 line-clamp-2">
                {item.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
