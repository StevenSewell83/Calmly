import { forwardRef, useEffect, useRef, useState } from "react";
import { ArrowRight, Calendar, Check, X } from "lucide-react";
import type { ReviewTaskItem } from "../../../preload/api-types";

interface Props {
  item: ReviewTaskItem;
  selected: boolean;
  // External signal for the "Move to date" date picker. The parent
  // sets it via the keyboard 'M' shortcut on the selected row.
  movePopoverOpen: boolean;
  onSelect: () => void;
  onCarryForward: () => void;
  onDrop: () => void;
  onMarkDone: () => void;
  onMoveToDate: (dueAtMs: number) => void;
  onMovePopoverChange: (open: boolean) => void;
}

// Single unfinished-task row. Per-row actions: Carry forward
// (default — push 24h), Drop (status='dropped'), Done (the "I forgot
// to mark it earlier" affordance), Move to date (date picker).
//
// forwardRef so the parent can imperatively scroll the keyboard-
// selected row into view as 'C' / 'D' actions remove rows from the
// list and selection shifts.
export const UnfinishedRow = forwardRef<HTMLLIElement, Props>(
  function UnfinishedRow(props, ref): JSX.Element {
    const {
      item,
      selected,
      movePopoverOpen,
      onSelect,
      onCarryForward,
      onDrop,
      onMarkDone,
      onMoveToDate,
      onMovePopoverChange,
    } = props;

    return (
      <li
        ref={ref}
        onClick={onSelect}
        role="option"
        aria-selected={selected}
        className={[
          "group rounded-[1.4rem] bg-white px-5 py-4 border transition-colors cursor-default",
          selected
            ? "border-emerald-300 ring-2 ring-emerald-100 shadow-sm"
            : "border-stone-200/60 hover:border-stone-300",
        ].join(" ")}
      >
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-stone-800 leading-relaxed line-clamp-1">
              {item.title}
            </p>
            <p className="mt-1.5 text-[10px] tracking-[0.18em] uppercase text-stone-400 font-bold">
              {item.status === "in_progress" ? "In progress" : "Open"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ActionButton
              label="Drop"
              title="Drop · D"
              tone="rose"
              onClick={(e) => {
                e.stopPropagation();
                onDrop();
              }}
            >
              <X className="w-4 h-4" />
            </ActionButton>
            <MoveToDateControl
              open={movePopoverOpen}
              onOpenChange={onMovePopoverChange}
              onPick={onMoveToDate}
            />
            <ActionButton
              label="Mark done"
              title="Mark done"
              tone="emerald"
              onClick={(e) => {
                e.stopPropagation();
                onMarkDone();
              }}
            >
              <Check className="w-4 h-4" />
            </ActionButton>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCarryForward();
              }}
              aria-label="Carry forward"
              title="Carry forward · C"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-stone-900 text-white text-xs font-medium tracking-wide hover:bg-stone-700 transition-colors"
            >
              Carry
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </li>
    );
  },
);

type Tone = "rose" | "emerald" | "stone";

const TONE_CLASSES: Record<Tone, string> = {
  rose: "text-stone-400 hover:text-rose-600 hover:bg-rose-50",
  emerald: "text-stone-400 hover:text-emerald-600 hover:bg-emerald-50",
  stone: "text-stone-400 hover:text-stone-700 hover:bg-stone-100",
};

interface ActionButtonProps {
  label: string;
  title: string;
  tone: Tone;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}

function ActionButton({
  label,
  title,
  tone,
  onClick,
  children,
}: ActionButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={title}
      className={[
        "w-9 h-9 rounded-2xl flex items-center justify-center transition-colors",
        TONE_CLASSES[tone],
      ].join(" ")}
    >
      {children}
    </button>
  );
}

interface MovePopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (dueAtMs: number) => void;
}

// Inline date picker anchored to the calendar button. The native
// input[type=date] handles validation and locale formatting; we just
// translate the YYYY-MM-DD value back to a unix-ms at the start of
// that day in the user's local tz.
function MoveToDateControl({
  open,
  onOpenChange,
  onPick,
}: MovePopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={ref} className="relative">
      <ActionButton
        label="Move to date"
        title="Move to date · M"
        tone="stone"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
      >
        <Calendar className="w-4 h-4" />
      </ActionButton>
      {open ? (
        <div
          role="dialog"
          aria-label="Move to date"
          className="absolute right-0 top-11 z-20 w-56 rounded-2xl bg-white border border-stone-200 shadow-xl p-3 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <label className="block text-[10px] font-bold tracking-[0.18em] uppercase text-stone-500 mb-2">
            New due date
          </label>
          <input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-stone-200 text-sm text-stone-800 focus:outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
          />
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="text-xs text-stone-500 px-2 py-1 hover:text-stone-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!value}
              onClick={() => {
                const ms = parseLocalDate(value);
                if (ms !== null) {
                  onPick(ms);
                  onOpenChange(false);
                  setValue("");
                }
              }}
              className="text-xs px-3 py-1.5 rounded-xl bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed"
            >
              Move
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// 'YYYY-MM-DD' from <input type=date> → unix-ms at local-tz midnight.
// Returns null on malformed input rather than NaN, so the disabled
// 'Move' button never fires a bad IPC payload.
function parseLocalDate(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(year, month, day, 0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}
