import { useEffect } from "react";
import {
  snoozeNextWeek,
  snoozeOneHour,
  snoozeTomorrowMorning,
} from "../useInboxList";

interface Props {
  onPick: (untilMs: number) => void;
  onClose: () => void;
}

// Inline snooze popover with three preset chips (1h / tomorrow morning
// / next week). Single click commits + closes; Escape also closes.
// Uses the same snoozeOneHour / snoozeTomorrowMorning / snoozeNextWeek
// helpers as InboxRow so list-view and triage-view chips are
// equivalent.
export function SnoozeMenu({ onPick, onClose }: Props): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const now = Date.now();
  return (
    <div
      role="menu"
      className="mt-3 rounded-2xl bg-white border border-stone-200 shadow-lg p-2 inline-flex gap-2"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(snoozeOneHour(now))}
        className="px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        In 1 hour
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(snoozeTomorrowMorning(now))}
        className="px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        Tomorrow morning
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => onPick(snoozeNextWeek(now))}
        className="px-3 py-1.5 rounded-xl text-xs font-medium tracking-wide bg-stone-100 hover:bg-stone-200 text-stone-700"
      >
        Next week
      </button>
    </div>
  );
}
