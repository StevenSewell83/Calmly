import type {
  FocusSourceWire,
  PlanTaskItem,
} from "../../../preload/api-types";

// CL-09b pure helpers used by the Focus page. Kept in their own file
// so the rest of pages/Focus stays component-only and react-refresh
// hot-reloads cleanly.

// 'scheduled' if the task carries a placed-on-grid time-block, 'ad-hoc'
// otherwise. CL-09 IPC validates the same union so any value other
// than these two would be rejected at the boundary anyway.
export function sourceForTask(task: PlanTaskItem): FocusSourceWire {
  return task.scheduled_start !== null ? "scheduled" : "ad-hoc";
}

// Returns a flat, deduplicated list of today's actionable tasks ranked
// scheduled-first then backlog. Used by the empty-state chooser AND
// the switch-task picker; both want the same ordering.
export function focusableTasks(
  scheduled: PlanTaskItem[],
  backlog: PlanTaskItem[],
): PlanTaskItem[] {
  const seen = new Set<string>();
  const out: PlanTaskItem[] = [];
  for (const t of scheduled) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  for (const t of backlog) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

// "Next step" sub-line per PRD §11:
//   - Parent task (has open children in today's plan) → first child
//     by scheduled_start, falling back to due_at, then title.
//   - Leaf task → notes truncated to a single line.
//   - Otherwise → null (renderer hides the sub-line).
export function nextStepFor(
  task: PlanTaskItem,
  todaysTasks: PlanTaskItem[],
): string | null {
  const children = todaysTasks.filter(
    (t) =>
      t.parent_task_id === task.id &&
      (t.status === "open" || t.status === "in_progress"),
  );
  if (children.length > 0) {
    children.sort((a, b) => {
      const ka = a.scheduled_start ?? a.due_at ?? Number.MAX_SAFE_INTEGER;
      const kb = b.scheduled_start ?? b.due_at ?? Number.MAX_SAFE_INTEGER;
      if (ka !== kb) return ka - kb;
      return a.title.localeCompare(b.title);
    });
    return children[0]!.title;
  }
  if (task.notes && task.notes.trim().length > 0) {
    return collapseToLine(task.notes);
  }
  return null;
}

function collapseToLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Elapsed-since-started formatter. < 1 min → "Just started", < 1 hr →
// "Nm", otherwise "Hh Mm". Returns "—" for non-positive (e.g. clock
// drift after midnight rollover).
export function formatElapsed(ms: number): string {
  if (ms <= 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return "Just started";
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

// Scheduled window pill, "9:00 – 9:30". Returns null when either edge
// is missing so the renderer can omit the pill entirely.
export function formatScheduledWindow(
  startMs: number | null,
  endMs: number | null,
): string | null {
  if (startMs === null || endMs === null) return null;
  return `${formatClock(startMs)} – ${formatClock(endMs)}`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
