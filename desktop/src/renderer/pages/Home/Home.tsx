import { useMemo, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { InboxTriageCard } from "./InboxTriageCard";
import { NextCard } from "./NextCard";
import { NowCard } from "./NowCard";
import { StubModal } from "./StubModal";
import { TodayList } from "./TodayList";
import {
  buildTodayList,
  pickNextItem,
  pickNowTask,
  useTodaySummary,
} from "./useTodaySummary";

export function Home() {
  const { state } = useTodaySummary();
  const [replanOpen, setReplanOpen] = useState(false);
  const [quickPlanOpen, setQuickPlanOpen] = useState(false);

  // Now is recomputed every render — cheap, and avoids stale-time
  // bugs across day rollovers when the app sits open through midnight.
  const now = Date.now();

  const summary = state.kind === "ready" ? state.summary : null;

  const nowTask = useMemo(
    () => (summary ? pickNowTask(summary.tasks) : null),
    [summary],
  );
  const nextItem = useMemo(
    () =>
      summary ? pickNextItem(summary.tasks, summary.events, now) : null,
    [summary, now],
  );
  const todayItems = useMemo(
    () => (summary ? buildTodayList(summary.tasks, summary.events) : []),
    [summary],
  );

  return (
    <section className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-10">
        <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
          Peace, friend.
        </h1>
        <p className="mt-3 text-sm text-stone-400 tracking-wide">
          Here is your landscape today.
        </p>
      </header>

      {state.kind === "loading" ? (
        <LoadingShell />
      ) : state.kind === "signed-out" ? (
        <FailureNotice
          title="You're signed out."
          body="Sign in to see today's plan."
        />
      ) : state.kind === "error" ? (
        <FailureNotice
          title="Something hiccuped."
          body={state.message}
        />
      ) : (
        <div className="flex flex-col gap-8 max-w-3xl">
          <NowCard task={nowTask} />
          <NextCard next={nextItem} now={now} />

          {summary && summary.unresolvedInboxCount > 0 ? (
            <InboxTriageCard count={summary.unresolvedInboxCount} />
          ) : null}

          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-stone-400" />
                Today
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuickPlanOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide text-stone-600 hover:bg-stone-100 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                  Quick Plan
                </button>
                <button
                  type="button"
                  onClick={() => setReplanOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide text-stone-600 hover:bg-stone-100 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Replan
                </button>
              </div>
            </div>
            <TodayList items={todayItems} />
          </div>
        </div>
      )}

      <StubModal
        open={quickPlanOpen}
        onClose={() => setQuickPlanOpen(false)}
        title="Quick Plan ritual"
        body="Each morning we'll walk through Today's plan together — confirm, reorder, drop, or shrink. The ritual itself is still on the way."
        beadId="CL-08"
      />
      <StubModal
        open={replanOpen}
        onClose={() => setReplanOpen(false)}
        title="Replan"
        body="When the day shifts, Replan will help you push, drop, shrink, or move what's on your plate without losing your footing."
        beadId="CL-12"
      />
    </section>
  );
}

function LoadingShell() {
  return (
    <div
      role="status"
      aria-label="Loading today"
      className="flex flex-col gap-8 max-w-3xl"
    >
      <div className="rounded-[2.5rem] bg-stone-100/60 h-28 animate-pulse" />
      <div className="rounded-[1.8rem] bg-stone-100/60 h-20 animate-pulse" />
      <div className="rounded-[1.6rem] bg-stone-100/60 h-14 animate-pulse" />
      <div className="rounded-[1.6rem] bg-stone-100/60 h-14 animate-pulse" />
    </div>
  );
}

function FailureNotice({ title, body }: { title: string; body: string }) {
  return (
    <div
      role="alert"
      className="rounded-[1.8rem] border border-stone-200 bg-white/60 px-6 py-5 max-w-md"
    >
      <p className="text-sm text-stone-800 font-medium">{title}</p>
      <p className="mt-1 text-xs text-stone-500">{body}</p>
    </div>
  );
}
