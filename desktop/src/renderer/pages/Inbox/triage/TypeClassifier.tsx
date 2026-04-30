import { CalendarClock, CheckCircle2, Sparkles, Trash2 } from "lucide-react";
import type { TriageType } from "./types";

interface Props {
  value: TriageType;
  onChange: (next: TriageType) => void;
}

const TYPE_OPTIONS: {
  value: TriageType;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}[] = [
  { value: "task", label: "Task", hint: "1", icon: CheckCircle2 },
  { value: "event", label: "Event", hint: "2", icon: CalendarClock },
  { value: "discard", label: "Discard", hint: "3", icon: Trash2 },
];

// Three-way radio for inbox-item classification. Keys 1/2/3 from the
// keyboard hook target the same callback so mouse + keyboard land in
// the same place.
export function TypeClassifier({ value, onChange }: Props): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Type"
      className="mt-6 grid grid-cols-3 gap-2"
    >
      {TYPE_OPTIONS.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={[
              "rounded-2xl border px-4 py-4 flex flex-col items-start gap-1 transition-colors",
              active
                ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-100"
                : "border-stone-200 bg-white hover:border-stone-300",
            ].join(" ")}
          >
            <span
              className={`flex items-center gap-2 text-sm font-medium tracking-wide ${
                active ? "text-emerald-700" : "text-stone-700"
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              {opt.label}
            </span>
            <span className="text-[10px] tracking-[0.22em] uppercase text-stone-400 font-bold">
              {opt.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
