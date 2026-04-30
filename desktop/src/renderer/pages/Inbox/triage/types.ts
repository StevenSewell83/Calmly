// CL-04 / REFACTOR-AUDIT-3 shared types for the triage focused-mode
// page. Lives outside the orchestrator so DueDateChips, PickDateButton
// and the keyboard hook can reuse the same union without circular
// imports.

export type TriageType = "task" | "event" | "discard";

export type DateChoice =
  | { kind: "today" | "tomorrow" | "thisWeek" | "later" }
  | { kind: "pick"; ms: number };

// Chip keys are only the simple (no-payload) DateChoice variants — the
// "pick" variant carries a timestamp and is selected via the date picker
// instead of a chip.
export type SimpleDateKind = Exclude<DateChoice["kind"], "pick">;

export interface ChipDef {
  key: SimpleDateKind;
  label: string;
}

export const CHIPS: ChipDef[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "thisWeek", label: "This Week" },
  { key: "later", label: "Later" },
];
