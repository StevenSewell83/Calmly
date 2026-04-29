import { Link } from "react-router-dom";
import { Inbox } from "lucide-react";

interface Props {
  count: number;
}

// Conditional card surfaced when the inbox has unresolved items. The
// emerald-on-stone palette gives it a quiet "noticed, not nagging"
// volume — anti-shame design language. Caller is responsible for
// hiding when count is zero.
export function InboxTriageCard({ count }: Props) {
  return (
    <div
      role="region"
      aria-label="Inbox awaiting triage"
      className="rounded-[1.8rem] bg-emerald-50/70 border border-emerald-100 px-6 py-5 flex items-center gap-5"
    >
      <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
        <Inbox className="w-4 h-4" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-emerald-700">
          Inbox
        </span>
        <p className="mt-1 text-sm text-stone-700">
          <span className="font-semibold tabular-nums">{count}</span>{" "}
          {count === 1 ? "item" : "items"} waiting to be sorted.
        </p>
      </div>
      <Link
        to="/inbox"
        className="px-4 py-2 rounded-2xl bg-emerald-600 text-white text-xs font-medium tracking-wide hover:bg-emerald-700 transition-colors shrink-0"
      >
        Triage now
      </Link>
    </div>
  );
}
