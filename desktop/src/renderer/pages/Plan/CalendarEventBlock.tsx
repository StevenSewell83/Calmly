// CAL-05: Read-only calendar event block rendered in the day grid.
// Not draggable or resizable — just a visual indicator of existing commitments.
import { Lock } from "lucide-react";
import type { CalendarDayEvent } from "../../../preload/api-types";
import { formatBlockRange, minutesToPx } from "./planMath";

export interface CalendarEventBlockProps {
  event: CalendarDayEvent;
  startMinutes: number;
  endMinutes: number;
}

export function CalendarEventBlock({ event, startMinutes, endMinutes }: CalendarEventBlockProps) {
  const top = minutesToPx(startMinutes);
  const height = Math.max(minutesToPx(endMinutes - startMinutes), 20);
  const providerLabel = event.provider === "google" ? "Google" : "Microsoft";

  return (
    <div
      role="note"
      aria-label={`${event.title}, ${formatBlockRange(startMinutes, endMinutes)}, from ${providerLabel} Calendar`}
      title={[event.title, event.location, formatBlockRange(startMinutes, endMinutes), `${providerLabel} Calendar`]
        .filter(Boolean)
        .join(" · ")}
      style={{ position: "absolute", top, left: 0, right: 0, height }}
      className="pointer-events-auto select-none rounded-xl px-2.5 py-1.5 bg-stone-100/90 border border-stone-200 shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-start gap-1.5 h-full overflow-hidden">
        <Lock className="w-2.5 h-2.5 text-stone-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-stone-600 truncate leading-tight">
            {event.title}
          </p>
          <p className="text-[9px] text-stone-400 tracking-wide mt-0.5">
            {formatBlockRange(startMinutes, endMinutes)} · {providerLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
