import { useRef, type ChangeEvent } from "react";
import type { DateChoice } from "./types";

interface Props {
  value: DateChoice;
  onChange: (next: DateChoice) => void;
}

// Inline date picker that fronts a hidden <input type="date">. Used by
// DueDateChips when none of the four preset chips fits. The hidden
// input is positioned off-screen but still keyboard-reachable through
// the visible button via showPicker() (with click() fallback).
export function PickDateButton({ value, onChange }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const active = value.kind === "pick";
  const display = active
    ? new Date(value.ms).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "Pick date";

  const onPick = (e: ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value;
    if (!v) return;
    // Native date input is yyyy-mm-dd; anchor at end-of-day local.
    const [y, m, d] = v.split("-").map((s) => parseInt(s, 10));
    if (!y || !m || !d) return;
    const ms = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
    onChange({ kind: "pick", ms });
  };

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() =>
          inputRef.current?.showPicker?.() ?? inputRef.current?.click()
        }
        className={[
          "px-4 py-2 rounded-2xl text-xs font-medium tracking-wide transition-colors",
          active
            ? "bg-emerald-500 text-white"
            : "bg-stone-100 text-stone-700 hover:bg-stone-200",
        ].join(" ")}
      >
        {display}
      </button>
      <input
        ref={inputRef}
        type="date"
        onChange={onPick}
        className="absolute opacity-0 pointer-events-none -z-10"
        aria-label="Pick a date"
      />
    </span>
  );
}
