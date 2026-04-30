import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { Backlog } from "./Backlog";
import { DayGrid } from "./DayGrid";
import {
  clampDurationMinutes,
  clampStartMinutes,
  DEFAULT_BLOCK_MINUTES,
  detectOverlaps,
  GRID_HOURS,
  gridMinutesToMs,
  msToGridMinutes,
  PX_PER_MINUTE,
  snapAndClampStartForDuration,
  snapMinutes,
} from "./planMath";
import { usePlanForDay } from "./usePlanForDay";

const DAY_MS = 24 * 60 * 60 * 1000;

function dayHeading(day: number, today: number): string {
  const d = new Date(day);
  const t = new Date(today);
  const sameDay =
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate();
  const tomorrow = new Date(today + DAY_MS);
  const yesterday = new Date(today - DAY_MS);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (sameDay) return "Today.";
  if (isTomorrow) return "Tomorrow.";
  if (isYesterday) return "Yesterday.";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function Plan() {
  // Day anchor — any unix-ms within the desired local day. Defaults
  // to today; ±1 day buttons walk the picker. The first render uses
  // Date.now() once; the user can revisit "Today" via a button.
  const [day, setDay] = useState<number>(() => Date.now());
  const [today] = useState<number>(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  });
  const { state, refresh } = usePlanForDay(day);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Avoid hijacking clicks for tap targets; require a small drag
      // distance before move starts.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor),
  );

  const persistSchedule = useCallback(
    async (taskId: string, startMs: number, endMs: number) => {
      const r = await window.calmly.plan.schedule({
        taskId,
        startAt: startMs,
        endAt: endMs,
      });
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const data = e.active.data.current as
        | { kind: "backlog"; taskId: string }
        | { kind: "block"; taskId: string; startMinutes: number; endMinutes: number }
        | undefined;
      if (!data) return;

      if (data.kind === "backlog") {
        const over = e.over?.data.current as
          | { kind: "slot"; minutesFromStart: number }
          | undefined;
        if (!over || over.kind !== "slot") return;
        const startMinutes = snapAndClampStartForDuration(
          over.minutesFromStart,
          DEFAULT_BLOCK_MINUTES,
        );
        const endMinutes = startMinutes + DEFAULT_BLOCK_MINUTES;
        const startMs = gridMinutesToMs(startMinutes, day);
        const endMs = gridMinutesToMs(endMinutes, day);
        void persistSchedule(data.taskId, startMs, endMs);
        return;
      }

      // block move — purely delta-driven so the snap matches the
      // drag direction even when the block crosses many slots.
      const dyMinutes = e.delta.y / PX_PER_MINUTE;
      const snappedDelta = snapMinutes(dyMinutes);
      if (snappedDelta === 0) return;
      const duration = data.endMinutes - data.startMinutes;
      const newStart = clampStartMinutes(data.startMinutes + snappedDelta);
      const safeDuration = clampDurationMinutes(duration, newStart);
      const newEnd = newStart + safeDuration;
      const startMs = gridMinutesToMs(newStart, day);
      const endMs = gridMinutesToMs(newEnd, day);
      void persistSchedule(data.taskId, startMs, endMs);
    },
    [day, persistSchedule],
  );

  const onBlockResize = useCallback(
    (taskId: string, newEndMinutes: number) => {
      if (state.kind !== "ready") return;
      const block = state.plan.scheduled.find((t) => t.id === taskId);
      if (!block || block.scheduled_start === null) return;
      const endMs = gridMinutesToMs(newEndMinutes, day);
      void persistSchedule(taskId, block.scheduled_start, endMs);
    },
    [day, state, persistSchedule],
  );

  const onBlockClick = useCallback((_task: PlanTaskItem) => {
    // CL-06c (TaskSidePanel) wires the actual editor here. For
    // CL-06b we keep the click handler but no-op so the block stays
    // keyboard-reachable without throwing surprise modals.
  }, []);

  const blocks = useMemo(() => {
    if (state.kind !== "ready") return [];
    const placed = state.plan.scheduled.filter(
      (t) => t.scheduled_start !== null && t.scheduled_end !== null,
    );
    const overlaps = detectOverlaps(
      placed.map((t) => ({
        id: t.id,
        startMs: t.scheduled_start as number,
        endMs: t.scheduled_end as number,
      })),
    );
    return placed.map((task) => {
      const rawStart = msToGridMinutes(task.scheduled_start as number, day);
      const rawEnd = msToGridMinutes(task.scheduled_end as number, day);
      // Visually clamp blocks that bleed past 06:00 / 23:00. The DB
      // values stay untouched — we only round for layout.
      const startMinutes = Math.max(0, Math.min(GRID_HOURS * 60 - 15, rawStart));
      const endMinutes = Math.max(startMinutes + 15, Math.min(GRID_HOURS * 60, rawEnd));
      return {
        task,
        startMinutes,
        endMinutes,
        overlapped: overlaps.has(task.id),
      };
    });
  }, [state, day]);

  const heading = dayHeading(day, today);

  return (
    <section className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="mb-8 flex items-end justify-between gap-6 max-w-5xl">
        <div>
          <h1 className="font-serif italic text-5xl tracking-tight text-stone-800">
            {heading}
          </h1>
          <p className="mt-3 text-sm text-stone-400 tracking-wide">
            Drag from backlog to place a block. Drag blocks to reschedule.
          </p>
        </div>
        <DayPicker
          day={day}
          today={today}
          onPrev={() => setDay((d) => d - DAY_MS)}
          onNext={() => setDay((d) => d + DAY_MS)}
          onToday={() => setDay(today)}
        />
      </header>

      {state.kind === "loading" ? (
        <LoadingShell />
      ) : state.kind === "signed-out" ? (
        <FailureNotice
          title="You're signed out."
          body="Sign in to plan your day."
        />
      ) : state.kind === "error" ? (
        <FailureNotice title="Something hiccuped." body={state.message} />
      ) : (
        <DndContext
          sensors={sensors}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={onDragEnd}
        >
          <div className="flex gap-6 items-start">
            <div className="flex-1 min-w-0 max-h-[calc(100vh-14rem)] overflow-y-auto pr-2 custom-scrollbar">
              <DayGrid
                blocks={blocks}
                onBlockResize={onBlockResize}
                onBlockClick={onBlockClick}
              />
            </div>
            <Backlog items={state.plan.backlog} />
          </div>
        </DndContext>
      )}
    </section>
  );
}

interface DayPickerProps {
  day: number;
  today: number;
  onPrev(): void;
  onNext(): void;
  onToday(): void;
}

function DayPicker({ day, today, onPrev, onNext, onToday }: DayPickerProps) {
  const isToday =
    new Date(day).toDateString() === new Date(today).toDateString();
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous day"
        className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onToday}
        disabled={isToday}
        className={[
          "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium tracking-wide transition-colors",
          isToday
            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
            : "text-stone-600 hover:bg-stone-100",
        ].join(" ")}
      >
        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
        Today
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next day"
        className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

function LoadingShell() {
  return (
    <div
      role="status"
      aria-label="Loading plan"
      className="flex gap-6 items-start"
    >
      <div className="flex-1 rounded-[1.8rem] bg-stone-100/60 h-[40rem] animate-pulse" />
      <div className="w-72 rounded-[2rem] bg-stone-100/60 h-[20rem] animate-pulse" />
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
