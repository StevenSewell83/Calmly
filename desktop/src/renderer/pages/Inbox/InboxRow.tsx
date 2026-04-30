import { forwardRef, useEffect, useRef } from "react";
import {
  ArrowRight,
  ClockArrowDown,
  MessageSquare,
  Mic,
  MonitorSmartphone,
  Sparkles,
  X,
} from "lucide-react";
import type { InboxItem, InboxItemSource } from "../../../preload/api-types";
import { formatRelativePast } from "../../utils/time";
import {
  snoozeNextWeek,
  snoozeOneHour,
  snoozeTomorrowMorning,
} from "../../utils/snooze";

interface Props {
  item: InboxItem;
  selected: boolean;
  // External signal: open this row's snooze popover. The List component
  // sets it via the keyboard 'S' shortcut on the selected row.
  snoozePopoverOpen: boolean;
  onSelect: () => void;
  onTriage: () => void;
  onSnooze: (untilMs: number) => void;
  onSkip: () => void;
  onSnoozePopoverChange: (open: boolean) => void;
}

const SOURCE_LABEL: Record<InboxItemSource, string> = {
  desktop: "Desktop",
  "telegram-text": "Telegram",
  "telegram-voice": "Voice",
  "ai-split": "AI split",
};

const SOURCE_ICON: Record<
  InboxItemSource,
  typeof MonitorSmartphone | typeof MessageSquare | typeof Mic | typeof Sparkles
> = {
  desktop: MonitorSmartphone,
  "telegram-text": MessageSquare,
  "telegram-voice": Mic,
  "ai-split": Sparkles,
};

// Single inbox row. forwardRef so the parent can imperatively scroll
// the keyboard-selected row into view when the user navigates with
// arrow keys.
export const InboxRow = forwardRef<HTMLLIElement, Props>(function InboxRow(
  props,
  ref,
) {
  const {
    item,
    selected,
    snoozePopoverOpen,
    onSelect,
    onTriage,
    onSnooze,
    onSkip,
    onSnoozePopoverChange,
  } = props;

  const Icon = SOURCE_ICON[item.source];

  return (
    <li
      ref={ref}
      onClick={onSelect}
      role="option"
      aria-selected={selected}
      className={[
        "group rounded-[1.8rem] bg-white px-6 py-5 border transition-colors cursor-default",
        selected
          ? "border-emerald-300 ring-2 ring-emerald-100 shadow-sm"
          : "border-stone-200/60 hover:border-stone-300",
      ].join(" ")}
    >
      <div className="flex items-start gap-4">
        <div className="w-9 h-9 rounded-2xl bg-stone-100 text-stone-500 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-stone-800 leading-relaxed line-clamp-2">
            {item.raw_text}
          </p>
          <div className="mt-2 flex items-center gap-3 text-[10px] tracking-[0.18em] uppercase text-stone-400 font-bold">
            <span>{SOURCE_LABEL[item.source]}</span>
            <span aria-hidden="true">·</span>
            <span className="normal-case tracking-wide font-medium">
              {formatRelativePast(item.created_at, Date.now())}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <SnoozeControl
            open={snoozePopoverOpen}
            onOpenChange={onSnoozePopoverChange}
            onPick={onSnooze}
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
            aria-label="Skip"
            title="Skip · X"
            className="w-9 h-9 rounded-2xl text-stone-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTriage();
            }}
            aria-label="Triage"
            title="Triage · Enter"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-stone-900 text-white text-xs font-medium tracking-wide hover:bg-stone-700 transition-colors"
          >
            Triage
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  );
});

interface SnoozeControlProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (untilMs: number) => void;
}

// Inline popover anchored to the snooze button. Three preset chips
// (1h, tomorrow, next week) — single click commits. Escape and click-
// outside both close. The 'S' keyboard shortcut from the parent flips
// `open` to true via onSnoozePopoverChange in the row props above.
function SnoozeControl({ open, onOpenChange, onPick }: SnoozeControlProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) {
        onOpenChange(false);
      }
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        aria-label="Snooze"
        aria-expanded={open}
        title="Snooze · S"
        className="w-9 h-9 rounded-2xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 flex items-center justify-center transition-colors"
      >
        <ClockArrowDown className="w-4 h-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-20 w-48 rounded-2xl bg-white border border-stone-200 shadow-xl py-2 animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <PresetButton
            label="In 1 hour"
            onClick={() => {
              onPick(snoozeOneHour(Date.now()));
              onOpenChange(false);
            }}
          />
          <PresetButton
            label="Tomorrow morning"
            onClick={() => {
              onPick(snoozeTomorrowMorning(Date.now()));
              onOpenChange(false);
            }}
          />
          <PresetButton
            label="Next week"
            onClick={() => {
              onPick(snoozeNextWeek(Date.now()));
              onOpenChange(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function PresetButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="block w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-50"
    >
      {label}
    </button>
  );
}

// Coarse relative phrasing for the row metadata strip.
