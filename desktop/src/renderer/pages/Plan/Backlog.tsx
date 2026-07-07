import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Inbox } from "lucide-react";
import type { PlanTaskItem } from "../../../preload/api-types";
import { PLAN_ITEM_ATTR } from "../../hooks/usePlanShortcuts";
import { useReminderRule } from "../../hooks/useReminderRule";
import { ReminderBadge } from "../../components/reminders/ReminderBadge";

interface BacklogRowProps {
  task: PlanTaskItem;
  onTaskClick(task: PlanTaskItem): void;
}

function BacklogRow({ task, onTaskClick }: BacklogRowProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `backlog:${task.id}`,
      data: { kind: "backlog", taskId: task.id },
    });
  const { state: reminderState } = useReminderRule(task.id);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: "none",
    zIndex: isDragging ? 50 : undefined,
    position: isDragging ? "relative" : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      // dnd-kit drag attributes (aria-roledescription etc) on the grip only;
      // the row itself gets a separate tabIndex for j/k focus navigation.
      tabIndex={0}
      role="listitem"
      aria-label={`${task.title}${task.notes ? `, ${task.notes}` : ""}. Press Enter to open.`}
      {...{ [PLAN_ITEM_ATTR]: task.id }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (!isDragging) onTaskClick(task);
        }
      }}
      onClick={(e) => { if (!isDragging) { e.stopPropagation(); onTaskClick(task); } }}
      className={[
        "group flex items-start gap-3 px-4 py-3 rounded-2xl bg-white/70",
        "border border-stone-100 shadow-sm select-none",
        "hover:border-emerald-200 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
      ].join(" ")}
    >
      {/* Drag handle — only this gets listeners so keyboard activation is separate */}
      <button
        type="button"
        aria-label={`Drag ${task.title}`}
        {...attributes}
        {...listeners}
        // tabIndex placed AFTER the spread so dnd-kit's attributes don't override
        // the deliberate -1: keyboard navigation should skip the grip and land on
        // the parent <li>, where Enter activates onTaskClick.
        tabIndex={-1}
        className="mt-0.5 shrink-0 cursor-grab active:cursor-grabbing focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical
          className="w-4 h-4 text-stone-300 group-hover:text-stone-500"
          aria-hidden="true"
        />
      </button>
      <div className="flex-1 min-w-0">
        <p className="flex items-center gap-1.5 text-sm text-stone-800 font-medium leading-snug truncate">
          <span className="truncate">{task.title}</span>
          {reminderState.kind === "ready" ? <ReminderBadge rule={reminderState.data} /> : null}
        </p>
        {task.notes ? (
          <p className="text-[11px] text-stone-400 mt-0.5 truncate">
            {task.notes}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export interface BacklogProps {
  items: PlanTaskItem[];
  onTaskClick(task: PlanTaskItem): void;
}

export function Backlog({ items, onTaskClick }: BacklogProps) {
  return (
    <aside
      aria-label="Backlog"
      className="w-72 shrink-0 flex flex-col rounded-[2rem] bg-white/40 border border-stone-100 p-5 max-h-[calc(100vh-12rem)]"
    >
      <header className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-[10px] font-bold tracking-[0.22em] uppercase text-stone-500 flex items-center gap-2">
          <Inbox className="w-3.5 h-3.5" aria-hidden="true" />
          Backlog
        </h2>
        <span className="text-[10px] text-stone-400 font-medium tracking-wide">
          {items.length}
        </span>
      </header>
      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-10 rounded-2xl border border-dashed border-stone-200 bg-white/30">
          <p className="text-xs text-stone-400 font-light max-w-[14rem]">
            Nothing waiting. Tasks due today without a time slot land here.
          </p>
        </div>
      ) : (
        <ul
          className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 custom-scrollbar"
          aria-label="Unscheduled tasks"
        >
          {items.map((task) => (
            <BacklogRow key={task.id} task={task} onTaskClick={onTaskClick} />
          ))}
        </ul>
      )}
    </aside>
  );
}
