import { useDroppable } from "@dnd-kit/core";
import type { CalendarDayEvent, PlanTaskItem } from "../../../preload/api-types";
import { TimeBlock } from "./TimeBlock";
import { CalendarEventBlock } from "./CalendarEventBlock";
import {
  buildSlotGuides,
  GRID_HEIGHT_PX,
  GRID_HOURS,
  minutesToPx,
  SLOT_SNAP_MINUTES,
} from "./planMath";

export interface DayGridProps {
  blocks: Array<{
    task: PlanTaskItem;
    startMinutes: number;
    endMinutes: number;
    overlapped: boolean;
  }>;
  calendarEvents?: Array<{
    event: CalendarDayEvent;
    startMinutes: number;
    endMinutes: number;
  }>;
  onBlockResize(taskId: string, newEndMinutes: number): void;
  onBlockClick(task: PlanTaskItem): void;
}

const SLOT_COUNT = (GRID_HOURS * 60) / SLOT_SNAP_MINUTES;

// Each 15-min slot is a micro-droppable so the DnD context can resolve
// `over.id` to a precise minutes-from-start number when a backlog row
// is dropped. Rendered as transparent overlays — visual guides come
// from buildSlotGuides() and live underneath.
function Slot({ minutesFromStart }: { minutesFromStart: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${minutesFromStart}`,
    data: { kind: "slot", minutesFromStart },
  });
  return (
    <div
      ref={setNodeRef}
      className={[
        "absolute left-0 right-0 transition-colors",
        isOver ? "bg-emerald-100/50 ring-1 ring-emerald-200/60" : "",
      ].join(" ")}
      style={{
        top: minutesToPx(minutesFromStart),
        height: minutesToPx(SLOT_SNAP_MINUTES),
      }}
      aria-hidden="true"
    />
  );
}

export function DayGrid({ blocks, calendarEvents = [], onBlockResize, onBlockClick }: DayGridProps) {
  const guides = buildSlotGuides();
  return (
    <div className="flex">
      {/* Left gutter: hour labels */}
      <div
        className="w-16 shrink-0 relative"
        style={{ height: GRID_HEIGHT_PX }}
        aria-hidden="true"
      >
        {guides
          .filter((g) => g.isHour)
          .map((g) => (
            <div
              key={g.minutesFromStart}
              className="absolute right-3 text-[10px] font-medium tracking-wide text-stone-400 -translate-y-1/2"
              style={{ top: minutesToPx(g.minutesFromStart) }}
            >
              {g.label}
            </div>
          ))}
      </div>

      {/* Block lane */}
      <div
        role="grid"
        aria-label="Day schedule"
        className="relative flex-1 rounded-[1.8rem] bg-stone-50/40 ring-1 ring-stone-100"
        style={{ height: GRID_HEIGHT_PX }}
      >
        {/* Visual guide lines — every 30 min, with hour rows stronger */}
        {guides.map((g) => (
          <div
            key={g.minutesFromStart}
            className={[
              "pointer-events-none absolute left-0 right-0 border-t",
              g.isHour ? "border-stone-200/80" : "border-stone-100",
            ].join(" ")}
            style={{ top: minutesToPx(g.minutesFromStart) }}
            aria-hidden="true"
          />
        ))}

        {/* Drop slots — invisible, but resolve drop targets to a 15-min minute offset */}
        {Array.from({ length: SLOT_COUNT }, (_, i) => i * SLOT_SNAP_MINUTES).map(
          (m) => (
            <Slot key={m} minutesFromStart={m} />
          ),
        )}

        {/* Calendar event blocks (read-only, behind task blocks) */}
        <div className="absolute inset-0 pointer-events-none">
          {calendarEvents.map((ce) => (
            <div
              key={ce.event.id}
              className="absolute left-2 right-2 pointer-events-auto"
              style={{ top: 0, height: GRID_HEIGHT_PX }}
            >
              <CalendarEventBlock
                event={ce.event}
                startMinutes={ce.startMinutes}
                endMinutes={ce.endMinutes}
              />
            </div>
          ))}
        </div>

        {/* Placed task blocks */}
        <div className="absolute inset-0 pointer-events-none">
          {blocks.map((b) => (
            <div
              key={b.task.id}
              className="absolute left-2 right-2 pointer-events-auto"
              style={{ top: 0, height: GRID_HEIGHT_PX }}
            >
              <TimeBlock
                task={b.task}
                startMinutes={b.startMinutes}
                endMinutes={b.endMinutes}
                overlapped={b.overlapped}
                onResizeCommit={onBlockResize}
                onClick={onBlockClick}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

