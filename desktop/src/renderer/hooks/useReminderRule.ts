import type { ReminderRuleItem } from "../../preload/api-types";
import { useResource, type UseResourceReturn } from "./useResource";

// Per-task reminder rule (RM-01a's IPC surface). Returns null (not an
// error) when the task simply has no rule yet — that's the common case,
// not a failure.
export function useReminderRule(
  taskId: string,
): UseResourceReturn<ReminderRuleItem | null> {
  return useResource<ReminderRuleItem | null>(async () => {
    const r = await window.calmly.reminders.get(taskId);
    if (!r.ok) {
      return r.error === "NotSignedIn"
        ? { kind: "signed-out" }
        : { kind: "error", message: r.error };
    }
    return { kind: "ok", data: r.rule };
  }, [taskId]);
}
