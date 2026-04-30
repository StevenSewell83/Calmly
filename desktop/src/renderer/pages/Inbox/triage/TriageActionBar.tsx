import {
  CalendarClock,
  CheckCircle2,
  ClockArrowDown,
  ListTree,
  Trash2,
  X,
} from "lucide-react";
import { PrimaryButton } from "./PrimaryButton";
import { SecondaryAction } from "./SecondaryAction";
import type { DateChoice, TriageType } from "./types";

interface Props {
  type: TriageType;
  submitting: boolean;
  titleEmpty: boolean;
  setDateChoice: (next: DateChoice) => void;
  submitTask: () => void;
  submitEvent: () => void;
  submitDiscard: () => void;
  toggleSnooze: () => void;
  skip: () => void;
  showBreakDownStub: () => void;
}

// REFACTOR-AUDIT-3 action-bar slice: the row of primary buttons that
// changes shape per type plus the always-on right-side cluster
// (Snooze / Skip / Break down). Lives outside the orchestrator so the
// page reads top-to-bottom as a layout sketch.
export function TriageActionBar({
  type,
  submitting,
  titleEmpty,
  setDateChoice,
  submitTask,
  submitEvent,
  submitDiscard,
  toggleSnooze,
  skip,
  showBreakDownStub,
}: Props): JSX.Element {
  const taskDisabled = submitting || titleEmpty;
  return (
    <div className="mt-8 flex items-center gap-3 flex-wrap">
      {type === "task" ? (
        <>
          <PrimaryButton
            label="Today"
            icon={CheckCircle2}
            onClick={() => {
              setDateChoice({ kind: "today" });
              submitTask();
            }}
            disabled={taskDisabled}
          />
          <PrimaryButton
            label="This Week"
            icon={CheckCircle2}
            onClick={() => {
              setDateChoice({ kind: "thisWeek" });
              submitTask();
            }}
            disabled={taskDisabled}
          />
          <PrimaryButton
            label="Later"
            icon={CheckCircle2}
            onClick={() => {
              setDateChoice({ kind: "later" });
              submitTask();
            }}
            disabled={taskDisabled}
          />
        </>
      ) : null}
      {type === "event" ? (
        <PrimaryButton
          label="Schedule event"
          icon={CalendarClock}
          onClick={submitEvent}
          disabled={submitting || titleEmpty}
        />
      ) : null}
      {type === "discard" ? (
        <PrimaryButton
          label="Discard"
          icon={Trash2}
          onClick={submitDiscard}
          disabled={submitting}
          tone="rose"
        />
      ) : null}

      <span className="ml-auto flex items-center gap-2">
        <SecondaryAction
          label="Snooze"
          hint="S"
          icon={ClockArrowDown}
          onClick={toggleSnooze}
        />
        <SecondaryAction
          label="Skip"
          hint="X"
          icon={X}
          onClick={skip}
        />
        <SecondaryAction
          label="Break down"
          hint=""
          icon={ListTree}
          onClick={showBreakDownStub}
          disabled
        />
      </span>
    </div>
  );
}
