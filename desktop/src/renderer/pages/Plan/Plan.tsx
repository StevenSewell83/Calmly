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
import type { PlanTaskItem } from "../../../preload/api-types";
import { Backlog } from "./Backlog";
import { DayGrid } from "./DayGrid";
import { DayPicker, FailureNotice, LoadingShell } from "./PlanShells";
import { TaskSidePanel } from "./TaskSidePanel";
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
  const [day, setDay] = useState<number>(() => Date.now());
  const [today] = useState<number>(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  });
  const { state, refresh } = usePlanForDay(day);
  const [activeTask, setActiveTask] = useState<PlanTaskItem | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const persistSchedule = useCallback(
    async (taskId: string, startMs: number, endMs: number) => {
      const r = await window.calmly.plan.schedule({ taskId, startAt: startMs, endAt: endMs });
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
        void persistSchedule(data.taskId, gridMinutesToMs(startMinutes, day), gridMinutesToMs(endMinutes, day));
        return;
      }

      const dyMinutes = e.delta.y / PX_PER_MINUTE;
      const snappedDelta = snapMinutes(dyMinutes);
      if (snappedDelta === 0) return;
      const duration = data.endMinutes - data.startMinutes;
      const newStart = clampStartMinutes(data.startMinutes + snappedDelta);
      const safeDuration = clampDurationMinutes(duration, newStart);
      void persistSchedule(
        data.taskId,
        gridMinutesToMs(newStart, day),
        gridMinutesToMs(newStart + safeDuration, day),
      );
    },
    [day, persistSchedule],
  );

  const onBlockResize = useCallback(
    (taskId: string, newEndMinutes: number) => {
      if (state.kind !== "ready") return;
      const block = state.plan.scheduled.find((t) => t.id === taskId);
      if (!block || block.scheduled_start === null) return;
      void persistSchedule(taskId, block.scheduled_start, gridMinutesToMs(newEndMinutes, day));
    },
    [day, state, persistSchedule],
  );

  const onBlockClick = useCallback((task: PlanTaskItem) => {
    setActiveTask(task);
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
      const startMinutes = Math.max(0, Math.min(GRID_HOURS * 60 - 15, rawStart));
      const endMinutes = Math.max(startMinutes + 15, Math.min(GRID_HOURS * 60, rawEnd));
      return { task, startMinutes, endMinutes, overlapped: overlaps.has(task.id) };
    });
  }, [state, day]);

  const heading = dayHeading(day, today);

  return (
    <section aria-labelledby="plan-page-title" className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 id="plan-page-title" className="sr-only">Plan</h1>
      <header className="mb-8 flex items-end justify-between gap-6 max-w-5xl">
        <div>
          <h2 className="font-serif italic text-5xl tracking-tight text-stone-800">
            {heading}
          </h2>
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
        <FailureNotice title="You're signed out." body="Sign in to plan your day." />
      ) : state.kind === "error" ? (
        <FailureNotice title="Something hiccuped." body={state.message} />
      ) : (
        <DndContext sensors={sensors} modifiers={[restrictToVerticalAxis]} onDragEnd={onDragEnd}>
          <div className="flex gap-6 items-start">
            <div className="flex-1 min-w-0 max-h-[calc(100vh-14rem)] overflow-y-auto pr-2 custom-scrollbar">
              <DayGrid blocks={blocks} onBlockResize={onBlockResize} onBlockClick={onBlockClick} />
            </div>
            <Backlog items={state.plan.backlog} onTaskClick={setActiveTask} />
          </div>
        </DndContext>
      )}

      <TaskSidePanel
        task={activeTask}
        day={day}
        onClose={() => setActiveTask(null)}
        onSaved={async () => { await refresh(); setActiveTask(null); }}
      />
    </section>
  );
}
