import { useEffect } from "react";
import {
  gridMinutesToMs,
  msToGridMinutes,
  snapAndClampStartForDuration,
  clampDurationMinutes,
} from "../pages/Plan/planMath";

const STEP_MINUTES = 15;

// DOM attribute used to mark focusable plan items (blocks + backlog rows).
export const PLAN_ITEM_ATTR = "data-plan-item";
// Extra attribute present only on placed blocks (value = taskId).
export const PLAN_BLOCK_ATTR = "data-plan-block";

export interface UsePlanShortcutsOpts {
  blocks: {
    task: { id: string; scheduled_start: number; scheduled_end: number };
    startMinutes: number;
    endMinutes: number;
  }[];
  day: number;
  onMoveBlock(taskId: string, newStartMs: number, newEndMs: number): void;
  onUnschedule(taskId: string): void;
  active?: boolean;
}

function planItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${PLAN_ITEM_ATTR}]`)];
}

function focusedPlanItem(): HTMLElement | null {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.hasAttribute(PLAN_ITEM_ATTR)) {
    return active;
  }
  return null;
}

export function usePlanShortcuts({
  blocks,
  day,
  onMoveBlock,
  onUnschedule,
  active = true,
}: UsePlanShortcutsOpts): void {
  useEffect(() => {
    if (!active) return;

    const handler = (e: KeyboardEvent): void => {
      // Don't steal keys from text inputs / modals.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        )
          return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const items = planItems();
      const focused = focusedPlanItem();
      const idx = focused ? items.indexOf(focused) : -1;

      // j / k — move focus down / up through plan items
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = e.key === "j" ? items[idx + 1] : items[idx - 1];
        next?.focus();
        return;
      }

      // Arrow Up / Down — move focused block by ±15 min
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const el = focused;
        const blockTaskId = el?.getAttribute(PLAN_BLOCK_ATTR);
        if (!blockTaskId) return;
        e.preventDefault();
        const block = blocks.find((b) => b.task.id === blockTaskId);
        if (!block) return;
        const delta = e.key === "ArrowUp" ? -STEP_MINUTES : STEP_MINUTES;
        const duration = block.endMinutes - block.startMinutes;
        const newStart = snapAndClampStartForDuration(
          block.startMinutes + delta,
          duration,
        );
        const safeDuration = clampDurationMinutes(duration, newStart);
        onMoveBlock(
          blockTaskId,
          gridMinutesToMs(newStart, day),
          gridMinutesToMs(newStart + safeDuration, day),
        );
        return;
      }

      // u — unschedule focused block
      if (e.key === "u") {
        const el = focused;
        const blockTaskId = el?.getAttribute(PLAN_BLOCK_ATTR);
        if (!blockTaskId) return;
        e.preventDefault();
        onUnschedule(blockTaskId);
        return;
      }

      // Tab to the first plan item when none is focused
      if (e.key === "Tab" && items.length > 0 && !focused) {
        // Let natural tab order handle it — don't intercept.
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [blocks, day, onMoveBlock, onUnschedule, active]);
}
