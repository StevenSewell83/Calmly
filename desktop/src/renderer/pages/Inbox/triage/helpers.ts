import type { InboxItem } from "../../../../preload/api-types";

// REFACTOR-AUDIT-3 helpers extracted from Triage.tsx. Pure functions
// only — keeping the orchestrator focused on state + IPC + layout.
// formatRelative also lives in InboxRow / NextCard; REFACTOR-AUDIT-7
// will collapse the three into shared/utils/time.ts.

// Round forward to the next hour boundary local time. Used as the
// default event start so the user only adjusts when needed.
export function nextRoundHour(now: number): number {
  const d = new Date(now);
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d.getTime();
}

// datetime-local inputs use 'yyyy-MM-ddTHH:mm' (local zone).
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseLocalInputValue(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Maps the IPC error codes from triage.* into one-line user-facing
// copy. Anything outside the documented union falls through to a
// generic "try again" so we never leak raw error tags into the page.
export function humanizeError(error: string): string {
  switch (error) {
    case "NotSignedIn":
      return "You're signed out — sign in to keep triaging.";
    case "NotFound":
      return "That item is gone — moving on.";
    case "AlreadyResolved":
      return "Already triaged — moving on.";
    case "InvalidArgs":
      return "Title can't be empty.";
    default:
      return "Couldn't save — try again.";
  }
}

export function sourceLabel(source: InboxItem["source"]): string {
  switch (source) {
    case "desktop":
      return "Desktop";
    case "telegram-text":
      return "Telegram";
    case "telegram-voice":
      return "Voice";
    case "ai-split":
      return "AI split";
  }
}

// Coarse relative phrasing. Duplicated in InboxRow.tsx and
// NextCard.tsx — REFACTOR-AUDIT-7 collapses the three into a shared
// utility.
export function formatRelative(at: number, now: number): string {
  const diffMs = Math.max(0, now - at);
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}
