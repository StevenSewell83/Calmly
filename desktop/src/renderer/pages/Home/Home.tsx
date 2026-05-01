import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Sparkles } from "lucide-react";
import { InboxTriageCard } from "./InboxTriageCard";
import { NextCard } from "./NextCard";
import { NowCard } from "./NowCard";
import { TodayList } from "./TodayList";
import { QuickPlan } from "../QuickPlan/QuickPlan";
import { ReplanModal } from "../../components/Replan/ReplanModal";
import { EmptyState } from "../../components/EmptyState";
import { PageStateView } from "../../components/PageStateView";
import {
  buildTodayList,
  pickNextItem,
  pickNowTask,
  useTodaySummary,
  type TodaySummary,
} from "./useTodaySummary";

function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function Home() {
  const { state } = useTodaySummary();
  const [replanOpen, setReplanOpen] = useState(false);
  const [quickPlanOpen, setQuickPlanOpen] = useState(false);
  const autoSuggestFired = useRef(false);
  const summary = state.kind === "ready" ? state.data : null;

  // Auto-suggest Quick Plan once per calendar day when there are commitments.
  // Preserves the prior behavior — TaskTodayItem doesn't carry scheduled_*
  // (those live on PlanTaskItem), so the original filter against
  // `t.scheduledStart !== null` was effectively "any task at all".
  useEffect(() => {
    if (autoSuggestFired.current || !summary) return;
    if (summary.tasks.length === 0) return;
    autoSuggestFired.current = true;
    void (async () => {
      const r = await window.calmly.quickplan.getDate();
      if (r.ok && r.date === todayLocalStr()) return;
      const timer = setTimeout(() => setQuickPlanOpen(true), 1_500);
      return () => clearTimeout(timer);
    })();
  }, [summary]);

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

      <PageStateView<TodaySummary>
        state={state}
        loadingFallback={<HomeLoadingShell />}
        signedOutBody="Sign in to see today's plan."
        ready={(data) => (
          <HomeContent
            summary={data}
            quickPlanOpen={quickPlanOpen}
            setQuickPlanOpen={setQuickPlanOpen}
            setReplanOpen={setReplanOpen}
          />
        )}
      />

      <QuickPlan open={quickPlanOpen} onClose={() => setQuickPlanOpen(false)} />
      <ReplanModal open={replanOpen} onClose={() => setReplanOpen(false)} />
    </section>
  );
}

interface HomeContentProps {
  summary: TodaySummary;
  quickPlanOpen: boolean;
  setQuickPlanOpen: (open: boolean) => void;
  setReplanOpen: (open: boolean) => void;
}

function HomeContent({
  summary,
  setQuickPlanOpen,
  setReplanOpen,
}: HomeContentProps) {
  const navigate = useNavigate();
  // Now is recomputed every render — cheap, and avoids stale-time
  // bugs across day rollovers when the app sits open through midnight.
  const now = Date.now();

  const nowTask = useMemo(() => pickNowTask(summary.tasks), [summary]);
  const nextItem = useMemo(
    () => pickNextItem(summary.tasks, summary.events, now),
    [summary, now],
  );
  const todayItems = useMemo(
    () => buildTodayList(summary.tasks, summary.events),
    [summary],
  );

  if (
    summary.tasks.length === 0 &&
    summary.unresolvedInboxCount === 0 &&
    summary.events.length === 0
  ) {
    return (
      <EmptyState
        name="home-first-open"
        title="Welcome to Calmly. Capture anything to start."
        body="Whatever's on your mind — tasks, ideas, worries — drop it here and sort it later."
        primaryAction={{
          label: "Capture a thought",
          onClick: () =>
            document
              .querySelector<HTMLInputElement>('[aria-label="Capture a thought"]')
              ?.focus(),
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <NowCard task={nowTask} />
      <NextCard next={nextItem} now={now} />

      {summary.unresolvedInboxCount > 0 ? (
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
        {todayItems.length === 0 ? (
          <EmptyState
            name="home-nothing-scheduled"
            title="Nothing on the schedule."
            body="Pick something from your backlog or capture a new task."
            primaryAction={{ label: "Go to Plan", onClick: () => navigate("/plan") }}
          />
        ) : (
          <TodayList items={todayItems} />
        )}
      </div>
    </div>
  );
}

// Home's loading shell uses a distinctive 4-row rhythm (hero + 3 list
// rows) — kept page-local because the default 3-row shell would feel
// jarring on a page whose ready state has a hero card.
function HomeLoadingShell() {
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
