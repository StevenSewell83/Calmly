import type { EventTodayItem, TaskTodayItem } from "../../../preload/api-types";
import { useResource, type UseResourceReturn } from "../../hooks/useResource";

// Single hook that fans out to the three Home reads in parallel and
// surfaces a typed summary. Splitting Now/Next derivation into the
// component (rather than the IPC) keeps the main process generic and
// keeps Home's logic where the visual states live.
export interface TodaySummary {
  tasks: TaskTodayItem[];
  events: EventTodayItem[];
  unresolvedInboxCount: number;
}

// Returns the current summary state plus a `refresh` thunk so the
// CaptureBar's add can opportunistically refetch the count after a
// successful capture without waiting for a route change. Any one of
// the three reads returning NotSignedIn means the renderer raced
// ahead of AuthGate; treat the whole summary as signed-out.
export function useTodaySummary(): UseResourceReturn<TodaySummary> {
  return useResource<TodaySummary>(async () => {
    const [tasksR, eventsR, countR] = await Promise.all([
      window.calmly.tasks.listToday(),
      window.calmly.events.listToday(),
      window.calmly.inbox.unresolvedCount(),
    ]);
    if (!tasksR.ok || !eventsR.ok || !countR.ok) {
      return { kind: "signed-out" };
    }
    return {
      kind: "ok",
      data: {
        tasks: tasksR.tasks,
        events: eventsR.events,
        unresolvedInboxCount: countR.count,
      },
    };
  }, []);
}

// Picks the "Now" task — first in_progress entry, falling back to null
// when nothing is in progress. Source data is already ordered Now-first
// by the SQL, so this is just a defensive narrow.
export function pickNowTask(tasks: TaskTodayItem[]): TaskTodayItem | null {
  for (const t of tasks) if (t.status === "in_progress") return t;
  return null;
}

// Picks the "Next" item — earliest upcoming task or event after `now`.
// Returns a discriminated union so the component can render task vs.
// event chrome differently.
export type NextItem =
  | { kind: "task"; task: TaskTodayItem }
  | { kind: "event"; event: EventTodayItem }
  | null;

export function pickNextItem(
  tasks: TaskTodayItem[],
  events: EventTodayItem[],
  now: number,
): NextItem {
  let best: { at: number; pick: NextItem } | null = null;

  for (const t of tasks) {
    // Skip the in_progress task — that's "Now", not "Next".
    if (t.status === "in_progress") continue;
    if (t.due_at == null || t.due_at <= now) continue;
    if (!best || t.due_at < best.at) {
      best = { at: t.due_at, pick: { kind: "task", task: t } };
    }
  }
  for (const e of events) {
    if (e.start_at <= now) continue;
    if (!best || e.start_at < best.at) {
      best = { at: e.start_at, pick: { kind: "event", event: e } };
    }
  }
  return best ? best.pick : null;
}

// Stable chronological ordering for the Today list — tasks anchored by
// due_at (or updated_at as a fallback for in_progress items without a
// due), events by start_at. Returns a flat list with a discriminator so
// the component can render either type inline.
export type TodayListItem =
  | { kind: "task"; at: number; task: TaskTodayItem }
  | { kind: "event"; at: number; event: EventTodayItem };

export function buildTodayList(
  tasks: TaskTodayItem[],
  events: EventTodayItem[],
): TodayListItem[] {
  const items: TodayListItem[] = [];
  for (const t of tasks) {
    items.push({
      kind: "task",
      at: t.due_at ?? t.updated_at,
      task: t,
    });
  }
  for (const e of events) {
    items.push({ kind: "event", at: e.start_at, event: e });
  }
  items.sort((a, b) => a.at - b.at);
  return items;
}
