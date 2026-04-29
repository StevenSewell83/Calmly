import { Link } from "react-router-dom";
import { Activity, Play } from "lucide-react";
import type { TaskTodayItem } from "../../../preload/api-types";

interface Props {
  task: TaskTodayItem | null;
}

// Hero card for the active focus. When a task is in_progress, render
// emerald accents + a "Continue focus" CTA. With nothing focused,
// drop to a low-volume invitation rather than a guilt-trip empty
// state — anti-shame is a PRD principle.
export function NowCard({ task }: Props) {
  if (task) {
    return (
      <article
        aria-label="Now"
        className="rounded-[2.5rem] bg-white border border-emerald-100 shadow-sm px-8 py-7 flex items-center gap-6"
      >
        <div className="w-14 h-14 rounded-[1.6rem] bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <Activity className="w-6 h-6" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-emerald-600">
            Now
          </span>
          <h2 className="mt-1 font-serif italic text-2xl text-stone-800 tracking-tight truncate">
            {task.title}
          </h2>
        </div>
        <Link
          to="/focus"
          className="px-5 py-2.5 rounded-2xl bg-emerald-500 text-white text-sm font-medium tracking-wide hover:bg-emerald-600 transition-colors shrink-0"
        >
          Continue focus
        </Link>
      </article>
    );
  }

  return (
    <article
      aria-label="Now"
      className="rounded-[2.5rem] bg-white/60 border border-stone-200/60 px-8 py-7 flex items-center gap-6"
    >
      <div className="w-14 h-14 rounded-[1.6rem] bg-stone-100 text-stone-400 flex items-center justify-center shrink-0">
        <Play className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-400">
          Now
        </span>
        <p className="mt-1 text-base text-stone-500 font-light">
          Nothing in focus. Pick something small.
        </p>
      </div>
      <Link
        to="/focus"
        className="px-5 py-2.5 rounded-2xl bg-stone-900 text-white text-sm font-medium tracking-wide hover:bg-stone-700 transition-colors shrink-0"
      >
        Start a focus block
      </Link>
    </article>
  );
}
