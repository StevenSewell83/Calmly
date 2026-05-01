import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import type { CalendarDayEvent, PlanTaskItem } from "../../../preload/api-types";

type PlacedTask = PlanTaskItem & { scheduled_start: number; scheduled_end: number };

function isPlaced(t: PlanTaskItem): t is PlacedTask {
  return t.scheduled_start !== null && t.scheduled_end !== null;
}
import { Backlog } from "./Backlog";
import { DayGrid } from "./DayGrid";
import { DayPicker, LoadingShell } from "./PlanShells";
import { PageStateView } from "../../components/PageStateView";
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
import { usePlanForDay, type PlanData } from "./usePlanForDay";
import { ReplanModal } from "../../components/Replan/ReplanModal";
import { usePlanShortcuts } from "../../hooks/usePlanShortcuts";
import { EmptyState } from "../../components/EmptyState";
import { CalendarReauthBanner } from "../../components/CalendarReauthBanner";

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
  const [day, setDay] = useState<number>(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  });
  const [today] = useState<number>(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d.getTime();
  });
  const { state, refresh } = usePlanForDay(day);
  const navigate = useNavigate();
  const [activeTask, setActiveTask] = useState<PlanTaskItem | null>(null);
  const [replanOpen, setReplanOpen] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarDayEvent[]>([]);

  const dayIso = useMemo(() => {
    const d = new Date(day);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
  }, [day]);

  const fetchCalendarEvents = useCallback(async () => {
    const r = await window.calmly.calendar.listEventsForDay(dayIso);
    if (r.ok) setCalendarEvents(r.events);
  }, [dayIso]);

  useEffect(() => {
    void fetchCalendarEvents();
  }, [fetchCalendarEvents]);

  useEffect(() => {
    const onFocus = () => { void fetchCalendarEvents(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchCalendarEvents]);

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
      const block = state.data.plan.scheduled.find((t) => t.id === taskId);
      if (!block || block.scheduled_start === null) return;
      void persistSchedule(taskId, block.scheduled_start, gridMinutesToMs(newEndMinutes, day));
    },
    [day, state, persistSchedule],
  );

  const onBlockClick = useCallback((task: PlanTaskItem) => {
    setActiveTask(task);
  }, []);

  const onUnschedule = useCallback(
    async (taskId: string) => {
      const r = await window.calmly.plan.unschedule(taskId);
      if (r.ok) await refresh();
    },
    [refresh],
  );

  const blocks = useMemo(() => {
    if (state.kind !== "ready") return [];
    const placed = state.data.plan.scheduled.filter(isPlaced);
    const overlaps = detectOverlaps(
      placed.map((t) => ({ id: t.id, startMs: t.scheduled_start, endMs: t.scheduled_end })),
    );
    return placed.map((task) => {
      const rawStart = msToGridMinutes(task.scheduled_start, day);
      const rawEnd = msToGridMinutes(task.scheduled_end, day);
      const startMinutes = Math.max(0, Math.min(GRID_HOURS * 60 - 15, rawStart));
      const endMinutes = Math.max(startMinutes + 15, Math.min(GRID_HOURS * 60, rawEnd));
      return { task, startMinutes, endMinutes, overlapped: overlaps.has(task.id) };
    });
  }, [state, day]);

  const calendarBlocks = useMemo(() =>
    calendarEvents
      .filter((ev) => !ev.isAllDay)
      .map((event) => {
        const rawStart = msToGridMinutes(event.startMs, day);
        const rawEnd = msToGridMinutes(event.endMs, day);
        const startMinutes = Math.max(0, Math.min(GRID_HOURS * 60 - 5, rawStart));
        const endMinutes = Math.max(startMinutes + 5, Math.min(GRID_HOURS * 60, rawEnd));
        return { event, startMinutes, endMinutes };
      }),
  [calendarEvents, day]);

  const allDayEvents = useMemo(
    () => calendarEvents.filter((ev) => ev.isAllDay),
    [calendarEvents],
  );

  const heading = dayHeading(day, today);

  usePlanShortcuts({
    blocks,
    day,
    onMoveBlock: persistSchedule,
    onUnschedule,
    active: state.kind === "ready" && !replanOpen && activeTask === null,
  });

  return (
    <section aria-labelledby="plan-page-title" className="flex-1 px-12 pt-10 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 id="plan-page-title" className="sr-only">Plan</h1>
      <header className="mb-8 flex items-end justify-between gap-6 max-w-5xl">
        <div>
          <h2 className="font-serif italic text-5xl tracking-tight text-stone-800">
            {heading}
          </h2>
          <p className="mt-3 text-sm text-stone-400 tracking-wide">
            Drag or use <kbd className="text-[10px] font-mono bg-stone-100 px-1 py-0.5 rounded border border-stone-200">j</kbd>/<kbd className="text-[10px] font-mono bg-stone-100 px-1 py-0.5 rounded border border-stone-200">k</kbd> to navigate · <kbd className="text-[10px] font-mono bg-stone-100 px-1 py-0.5 rounded border border-stone-200">↑↓</kbd> to move blocks · <kbd className="text-[10px] font-mono bg-stone-100 px-1 py-0.5 rounded border border-stone-200">u</kbd> to unschedule
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setReplanOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide text-stone-600 hover:bg-stone-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Replan
          </button>
          <DayPicker
            day={day}
            today={today}
            onPrev={() => setDay((d) => d - DAY_MS)}
            onNext={() => setDay((d) => d + DAY_MS)}
            onToday={() => setDay(today)}
          />
        </div>
      </header>

      <CalendarReauthBanner />

      <PageStateView<PlanData>
        state={state}
        loadingFallback={<LoadingShell />}
        signedOutBody="Sign in to plan your day."
        ready={(data) =>
          blocks.length === 0 && data.plan.backlog.length === 0 ? (
            <EmptyState
              name="plan-nothing-scheduled"
              title="Nothing on the schedule."
              body="Pick something from your backlog or capture a new task."
              primaryAction={{
                label: "Go to Inbox",
                onClick: () => navigate("/inbox"),
              }}
            />
          ) : (
            <DndContext
              sensors={sensors}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={onDragEnd}
            >
              <div className="flex gap-6 items-start">
                <div className="flex-1 min-w-0 max-h-[calc(100vh-14rem)] overflow-y-auto pr-2 custom-scrollbar">
                  {allDayEvents.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1.5" aria-label="All-day calendar events">
                      {allDayEvents.map((ev) => (
                        <span
                          key={ev.id}
                          title={`${ev.title} · ${ev.provider === "google" ? "Google" : "Microsoft"} Calendar`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-stone-100 border border-stone-200 text-[10px] text-stone-500"
                        >
                          {ev.title}
                        </span>
                      ))}
                    </div>
                  )}
                  <DayGrid
                    blocks={blocks}
                    calendarEvents={calendarBlocks}
                    onBlockResize={onBlockResize}
                    onBlockClick={onBlockClick}
                  />
                </div>
                <Backlog items={data.plan.backlog} onTaskClick={setActiveTask} />
              </div>
            </DndContext>
          )
        }
      />

      <ReplanModal open={replanOpen} onClose={() => setReplanOpen(false)} />
      <TaskSidePanel
        task={activeTask}
        day={day}
        onClose={() => setActiveTask(null)}
        onSaved={async () => { await refresh(); setActiveTask(null); }}
      />
    </section>
  );
}
