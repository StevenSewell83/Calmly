import { Bell } from "lucide-react";
import type { ReminderRuleItem } from "../../../preload/api-types";

export interface ReminderBadgeProps {
  // Accepts the full rule or just the two fields that decide rendering —
  // callers on a hot list (BacklogRow, TimeBlock) don't need to thread
  // the whole ReminderRuleItem through just to draw a dot.
  rule: Pick<ReminderRuleItem, "importance" | "active"> | null | undefined;
}

// RM-07's in-app treatment: Important surfaces a bell (may repeat/escalate
// visually later, e.g. re-surfacing in Today); Soft is a muted dot that
// never escalates. Deliberately no red and no counts — reminders inform,
// they don't alarm. Renders nothing for an inactive or missing rule.
export function ReminderBadge({ rule }: ReminderBadgeProps) {
  if (!rule || rule.active !== 1) return null;
  if (rule.importance === "important") {
    return (
      <Bell
        aria-label="Important reminder active"
        className="w-3.5 h-3.5 text-emerald-600 shrink-0"
      />
    );
  }
  return (
    <span
      aria-label="Soft reminder active"
      className="inline-block w-1.5 h-1.5 rounded-full bg-stone-300 shrink-0"
    />
  );
}
