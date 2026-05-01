import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

export interface DayPickerProps {
  day: number;
  today: number;
  onPrev(): void;
  onNext(): void;
  onToday(): void;
}

export function DayPicker({ day, today, onPrev, onNext, onToday }: DayPickerProps) {
  const isToday =
    new Date(day).toDateString() === new Date(today).toDateString();
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous day"
        className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onToday}
        disabled={isToday}
        className={[
          "inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium tracking-wide transition-colors",
          isToday
            ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
            : "text-stone-600 hover:bg-stone-100",
        ].join(" ")}
      >
        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
        Today
      </button>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next day"
        className="p-2 rounded-xl text-stone-500 hover:bg-stone-100 transition-colors"
      >
        <ChevronRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function LoadingShell() {
  return (
    <div
      role="status"
      aria-label="Loading plan"
      className="flex gap-6 items-start"
    >
      <div className="flex-1 rounded-[1.8rem] bg-stone-100/60 h-[40rem] animate-pulse" />
      <div className="w-72 rounded-[2rem] bg-stone-100/60 h-[20rem] animate-pulse" />
    </div>
  );
}

