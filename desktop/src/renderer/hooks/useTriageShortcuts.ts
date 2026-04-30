import { useEffect } from "react";
import type {
  DateChoice,
  TriageType,
} from "../pages/Inbox/triage/types";

export interface TriageShortcutHandlers {
  active: boolean;
  type: TriageType;
  setType: (next: TriageType) => void;
  setDateChoice: (next: DateChoice) => void;
  toggleSnooze: () => void;
  skip: () => void;
  confirmPrimary: () => void;
}

// Keyboard shortcut handler extracted from Triage.tsx (REFACTOR-AUDIT-3).
//   1/2/3   → swap type (task / event / discard)
//   T/W/L   → date chip (Task branch only)
//   S       → toggle snooze popover
//   X       → skip
//   Enter   → confirm primary action
// Skipped while focus is in INPUT / TEXTAREA so the title field is
// freely editable. `active` short-circuits the listener when there's no
// current item — keeps the Inbox-clear / loading shells quiet.
export function useTriageShortcuts(
  handlers: TriageShortcutHandlers,
): void {
  const {
    active,
    type,
    setType,
    setDateChoice,
    toggleSnooze,
    skip,
    confirmPrimary,
  } = handlers;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      ) {
        return;
      }
      if (e.key === "1") {
        e.preventDefault();
        setType("task");
        return;
      }
      if (e.key === "2") {
        e.preventDefault();
        setType("event");
        return;
      }
      if (e.key === "3") {
        e.preventDefault();
        setType("discard");
        return;
      }
      if (type === "task") {
        if (e.key === "t" || e.key === "T") {
          e.preventDefault();
          setDateChoice({ kind: "today" });
          return;
        }
        if (e.key === "w" || e.key === "W") {
          e.preventDefault();
          setDateChoice({ kind: "thisWeek" });
          return;
        }
        if (e.key === "l" || e.key === "L") {
          e.preventDefault();
          setDateChoice({ kind: "later" });
          return;
        }
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        toggleSnooze();
        return;
      }
      if (e.key === "x" || e.key === "X") {
        e.preventDefault();
        skip();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        confirmPrimary();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    active,
    type,
    setType,
    setDateChoice,
    toggleSnooze,
    skip,
    confirmPrimary,
  ]);
}
