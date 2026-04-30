import { Inbox as InboxIcon } from "lucide-react";
import type { InboxItem } from "../../../../preload/api-types";
import { formatRelative, sourceLabel } from "./helpers";

interface Props {
  item: InboxItem;
  now: number;
}

// REFACTOR-AUDIT-3 raw-item card: source label + relative timestamp
// metadata strip plus the inbox raw_text rendered as a quiet hero.
// Pulled out of Triage.tsx so the orchestrator's JSX reads as
// layout-only.
export function ItemCard({ item, now }: Props): JSX.Element {
  return (
    <article
      key={item.id}
      className="rounded-[2.5rem] bg-white border border-stone-200/60 shadow-sm px-8 py-7 animate-in fade-in slide-in-from-right-4 duration-300"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-[10px] font-bold tracking-[0.22em] uppercase text-stone-400">
        <InboxIcon className="w-3.5 h-3.5" aria-hidden="true" />
        <span>From {sourceLabel(item.source)}</span>
        <span aria-hidden="true">·</span>
        <span className="normal-case tracking-wide font-medium">
          {formatRelative(item.created_at, now)}
        </span>
      </div>
      <p className="mt-3 text-2xl text-stone-800 leading-snug font-light">
        {item.raw_text}
      </p>
    </article>
  );
}
