import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReviewTaskItem } from "../../../preload/api-types";
import { CompletedList } from "./CompletedList";
import { ReflectionInput } from "./ReflectionInput";
import {
  FailureNotice,
  LoadingShell,
  ShutdownFooter,
  SummaryStrip,
} from "./ReviewChrome";
import { UnfinishedRow } from "./UnfinishedRow";
import { useReviewSummary } from "./useReviewSummary";

// CL-13 Daily Shutdown screen. Three sections (Completed / Unfinished
// / Reflection) plus the close-the-day footer. Keyboard: C carries the
// selected unfinished task forward, D drops it, M opens the move-to-
// date picker, Enter completes the shutdown when not in an input.

export function Review(): JSX.Element {
  const { state, refresh } = useReviewSummary();
  const navigate = useNavigate();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [movePopoverId, setMovePopoverId] = useState<string | null>(null);
  const [reflection, setReflection] = useState<string>("");
  const [committing, setCommitting] = useState<boolean>(false);
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const reflectionInitialRef = useRef<string>("");

  const summary = state.kind === "ready" ? state.summary : null;
  const unfinished = useMemo<ReviewTaskItem[]>(
    () => summary?.unfinishedTasks ?? [],
    [summary],
  );

  // Seed the reflection input from the most recent server state once
  // the summary lands. Subsequent edits stay local until shutdown.
  useEffect(() => {
    if (summary?.reflection && reflectionInitialRef.current === "") {
      reflectionInitialRef.current = summary.reflection.text;
      setReflection(summary.reflection.text);
    }
  }, [summary]);

  // Keep the keyboard cursor on a row that still exists. Drops the
  // selection if the unfinished list empties (C/D/Done removes rows).
  useEffect(() => {
    if (unfinished.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !unfinished.some((t) => t.id === selectedId)) {
      setSelectedId(unfinished[0]!.id);
    }
  }, [unfinished, selectedId]);

  const carryForward = useCallback(
    async (id: string) => {
      const r = await window.calmly.review.carryForward({ taskIds: [id] });
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const dropTask = useCallback(
    async (id: string) => {
      const r = await window.calmly.review.drop({ taskIds: [id] });
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const markDone = useCallback(
    async (id: string) => {
      const r = await window.calmly.review.markDone({ taskIds: [id] });
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const moveToDate = useCallback(
    async (id: string, dueAtMs: number) => {
      const r = await window.calmly.review.moveToDate({
        taskIds: [id],
        dueAt: dueAtMs,
      });
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const completeShutdown = useCallback(async () => {
    if (!summary || committing) return;
    setCommitting(true);
    try {
      const r = await window.calmly.review.completeShutdown({
        date: summary.date,
        reflection: reflection.trim() === "" ? null : reflection,
      });
      if (r.ok) navigate("/");
    } finally {
      setCommitting(false);
    }
  }, [committing, navigate, reflection, summary]);

  // Global keyboard handler: C/D/M act on the selected row, Enter
  // closes the day. Skipped when focus is in an input or textarea so
  // typing in the reflection field doesn't trigger anything.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void completeShutdown();
        return;
      }
      if (!selectedId) return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        void carryForward(selectedId);
        return;
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        void dropTask(selectedId);
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setMovePopoverId(selectedId);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [carryForward, completeShutdown, dropTask, selectedId]);

  return (
    <section className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-10 max-w-3xl">
        <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
          Day&rsquo;s end.
        </h1>
        <p className="mt-3 text-sm text-stone-400 tracking-wide">
          Acknowledge what landed, gently move what didn&rsquo;t.
        </p>
        {summary ? (
          <SummaryStrip
            date={summary.date}
            focusedMs={summary.focusedMs}
            alreadyClosed={summary.lastShutdownDate === summary.date}
          />
        ) : null}
      </header>

      <div className="max-w-3xl flex flex-col gap-12">
        {state.kind === "loading" ? (
          <LoadingShell />
        ) : state.kind === "signed-out" ? (
          <FailureNotice
            title="You're signed out."
            body="Sign in to close out your day."
          />
        ) : state.kind === "error" ? (
          <FailureNotice title="Something hiccuped." body={state.message} />
        ) : (
          <>
            <CompletedList items={summary!.completedTasks} />
            <UnfinishedSection
              items={unfinished}
              selectedId={selectedId}
              movePopoverId={movePopoverId}
              rowRefs={rowRefs}
              onSelect={setSelectedId}
              onCarryForward={(id) => void carryForward(id)}
              onDrop={(id) => void dropTask(id)}
              onMarkDone={(id) => void markDone(id)}
              onMoveToDate={(id, ms) => void moveToDate(id, ms)}
              onMovePopoverChange={(id, open) =>
                setMovePopoverId(open ? id : null)
              }
            />
            <ReflectionInput
              initialText={reflectionInitialRef.current}
              onChange={setReflection}
            />
            <ShutdownFooter
              committing={committing}
              onComplete={() => void completeShutdown()}
              onSkip={() => navigate("/")}
            />
          </>
        )}
      </div>
    </section>
  );
}

interface UnfinishedSectionProps {
  items: ReviewTaskItem[];
  selectedId: string | null;
  movePopoverId: string | null;
  rowRefs: React.MutableRefObject<Map<string, HTMLLIElement>>;
  onSelect: (id: string) => void;
  onCarryForward: (id: string) => void;
  onDrop: (id: string) => void;
  onMarkDone: (id: string) => void;
  onMoveToDate: (id: string, dueAtMs: number) => void;
  onMovePopoverChange: (id: string, open: boolean) => void;
}

function UnfinishedSection(props: UnfinishedSectionProps): JSX.Element {
  const { items } = props;
  return (
    <section aria-labelledby="review-unfinished-heading">
      <header className="mb-4">
        <h2
          id="review-unfinished-heading"
          className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 flex items-center gap-2"
        >
          <span className="w-1 h-1 rounded-full bg-stone-400" />
          Unfinished today
        </h2>
        {items.length === 0 ? (
          <p className="mt-1 text-sm text-stone-500">
            Nothing left open. Beautifully done.
          </p>
        ) : (
          <p className="mt-1 text-sm text-stone-400 tracking-wide">
            {items.length === 1 ? "1 thing" : `${items.length} things`} —
            carry forward, drop, mark done, or move to a future date.
          </p>
        )}
      </header>
      {items.length === 0 ? null : (
        <ul
          role="listbox"
          aria-label="Unfinished tasks"
          className="flex flex-col gap-2"
        >
          {items.map((item) => (
            <UnfinishedRow
              key={item.id}
              ref={(el) => {
                if (el) props.rowRefs.current.set(item.id, el);
                else props.rowRefs.current.delete(item.id);
              }}
              item={item}
              selected={item.id === props.selectedId}
              movePopoverOpen={props.movePopoverId === item.id}
              onSelect={() => props.onSelect(item.id)}
              onCarryForward={() => props.onCarryForward(item.id)}
              onDrop={() => props.onDrop(item.id)}
              onMarkDone={() => props.onMarkDone(item.id)}
              onMoveToDate={(ms) => props.onMoveToDate(item.id, ms)}
              onMovePopoverChange={(open) =>
                props.onMovePopoverChange(item.id, open)
              }
            />
          ))}
        </ul>
      )}
      {items.length > 0 ? (
        <p className="mt-4 text-[11px] text-stone-400 tracking-wide">
          <span className="font-bold tracking-[0.18em] uppercase">Keys</span>{" "}
          · C carry forward · D drop · M move to date · Cmd-Enter close day
        </p>
      ) : null}
    </section>
  );
}

