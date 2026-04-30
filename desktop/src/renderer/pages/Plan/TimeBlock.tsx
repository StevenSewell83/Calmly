import { useCallback, useEffect, useRef, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { PlanTaskItem } from "../../../preload/api-types";
import {
  formatBlockRange,
  minutesToPx,
  PX_PER_MINUTE,
  snapAndClampEndForStart,
} from "./planMath";
import { PLAN_ITEM_ATTR, PLAN_BLOCK_ATTR } from "../../hooks/usePlanShortcuts";

export interface TimeBlockProps {
  task: PlanTaskItem;
  startMinutes: number;
  endMinutes: number;
  overlapped: boolean;
  // Called when the user releases the resize handle. The block has
  // already been clamped + snapped — the consumer just persists.
  onResizeCommit(taskId: string, newEndMinutes: number): void;
  onClick(task: PlanTaskItem): void;
}

// Time block placed inside DayGrid. Move-by-drag is handled through
// @dnd-kit (the surrounding DndContext owns drop math). Resize-by-
// drag uses native pointer events so we can preview the height
// without round-tripping through DndContext.
//
// Keyboard contract: Enter/Space opens the task panel (overrides the
// dnd-kit KeyboardSensor's default pick-up gesture). Arrow Up/Down
// moves the block ±15 min via usePlanShortcuts. `u` unschedules.
export function TimeBlock({
  task,
  startMinutes,
  endMinutes,
  overlapped,
  onResizeCommit,
  onClick,
}: TimeBlockProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `block:${task.id}`,
      data: { kind: "block", taskId: task.id, startMinutes, endMinutes },
    });

  const initialDuration = endMinutes - startMinutes;
  const [previewDuration, setPreviewDuration] = useState<number | null>(null);
  const resizeStartY = useRef<number | null>(null);
  const resizingPointerId = useRef<number | null>(null);

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      resizeStartY.current = e.clientY;
      resizingPointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      setPreviewDuration(initialDuration);
    },
    [initialDuration],
  );

  const onResizePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (resizingPointerId.current !== e.pointerId) return;
      if (resizeStartY.current === null) return;
      const dy = e.clientY - resizeStartY.current;
      const dyMinutes = dy / PX_PER_MINUTE;
      const rawEnd = endMinutes + dyMinutes;
      const snappedEnd = snapAndClampEndForStart(rawEnd, startMinutes);
      setPreviewDuration(snappedEnd - startMinutes);
    },
    [endMinutes, startMinutes],
  );

  const onResizePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (resizingPointerId.current !== e.pointerId) return;
      const finalDuration = previewDuration ?? initialDuration;
      const newEnd = startMinutes + finalDuration;
      resizeStartY.current = null;
      resizingPointerId.current = null;
      setPreviewDuration(null);
      if (newEnd !== endMinutes) {
        onResizeCommit(task.id, newEnd);
      }
    },
    [previewDuration, initialDuration, startMinutes, endMinutes, onResizeCommit, task.id],
  );

  useEffect(() => {
    return () => {
      resizeStartY.current = null;
      resizingPointerId.current = null;
    };
  }, []);

  const visibleDuration = previewDuration ?? initialDuration;
  const top = minutesToPx(startMinutes);
  const height = minutesToPx(visibleDuration);

  const style: React.CSSProperties = {
    position: "absolute",
    top,
    left: 0,
    right: 0,
    height,
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 30 : 10,
    opacity: isDragging ? 0.85 : 1,
    touchAction: "none",
  };

  const ring = overlapped
    ? "ring-2 ring-amber-300/80"
    : "ring-1 ring-emerald-200/60 hover:ring-emerald-300 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none";

  // dnd-kit attributes include aria-roledescription and aria-disabled.
  // We spread them but supply our own role/tabIndex/aria-label/onKeyDown.
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${task.title}, ${formatBlockRange(startMinutes, startMinutes + visibleDuration)}. Press Enter to open, Arrow keys to move.`}
      // data attrs used by usePlanShortcuts for j/k navigation and Arrow key moves
      {...{ [PLAN_ITEM_ATTR]: task.id, [PLAN_BLOCK_ATTR]: task.id }}
      // Override dnd-kit's onKeyDown: Enter/Space open the task panel instead
      // of initiating a keyboard drag. Arrow keys remain available for the
      // usePlanShortcuts handler at the document level.
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          if (!isDragging) onClick(task);
        }
      }}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onClick(task);
      }}
      className={[
        "group bg-emerald-50/90 backdrop-blur-sm rounded-2xl px-3 py-2",
        "shadow-sm cursor-grab active:cursor-grabbing select-none",
        "border border-emerald-100 transition-shadow",
        ring,
        overlapped ? "bg-amber-50/90 border-amber-200" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2 h-full">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-stone-800 truncate leading-tight">
            {task.title}
          </p>
          <p className="text-[10px] text-stone-500 tracking-wide mt-0.5">
            {formatBlockRange(startMinutes, startMinutes + visibleDuration)}
          </p>
        </div>
        {overlapped ? (
          <span
            className="text-[9px] font-bold tracking-[0.18em] uppercase text-amber-600 shrink-0 mt-0.5"
            aria-label="overlaps another block"
          >
            overlap
          </span>
        ) : null}
      </div>
      <button
        type="button"
        aria-label={`Resize ${task.title}`}
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize rounded-b-2xl hover:bg-emerald-200/40 focus:outline-none focus-visible:bg-emerald-200/40"
      />
    </div>
  );
}
