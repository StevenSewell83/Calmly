import { PickDateButton } from "./PickDateButton";
import { CHIPS, type DateChoice } from "./types";

interface Props {
  value: DateChoice;
  onChange: (next: DateChoice) => void;
}

// Four preset chips (Today / Tomorrow / This Week / Later) plus a
// 'Pick date' escape hatch for arbitrary days. Only renders for the
// 'task' branch — events use TimeInput pairs instead.
export function DueDateChips({ value, onChange }: Props): JSX.Element {
  return (
    <div className="mt-6">
      <div className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 mb-2">
        Due
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {CHIPS.map((chip) => {
          const active = value.kind === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={() => onChange({ kind: chip.key })}
              className={[
                "px-4 py-2 rounded-2xl text-xs font-medium tracking-wide transition-colors",
                active
                  ? "bg-emerald-500 text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200",
              ].join(" ")}
            >
              {chip.label}
            </button>
          );
        })}
        <PickDateButton value={value} onChange={onChange} />
      </div>
    </div>
  );
}
