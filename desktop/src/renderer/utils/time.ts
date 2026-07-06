/** h12:mm + meridiem parts for TodayList's split-styled clock display. */
export function formatClockParts(at: number): { hm: string; meridiem: string } {
  const d = new Date(at);
  const h12 = ((d.getHours() + 11) % 12) + 1;
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const meridiem = d.getHours() < 12 ? "am" : "pm";
  return { hm: `${h12}:${minutes}`, meridiem };
}

/** Full clock string e.g. "3:30 pm". */
export function formatClock(at: number): string {
  const { hm, meridiem } = formatClockParts(at);
  return `${hm} ${meridiem}`;
}

/**
 * Coarse relative phrase for past timestamps: "Just now", "5m ago", "2h ago",
 * "3d ago", "1w ago". Future timestamps return "Just now".
 */
export function formatRelativePast(at: number, now: number = Date.now()): string {
  const diffMs = Math.max(0, now - at);
  // Floor (not round) so e.g. 30s ago reads "Just now" rather than
  // rounding up to "1m ago" before a full minute has actually elapsed.
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
}

/**
 * Coarse relative phrase for future timestamps: "In 5 minutes", "In 2 hours".
 * Past/present timestamps return "Just now".
 */
export function formatRelativeFuture(at: number, now: number = Date.now()): string {
  const diffMs = at - now;
  if (diffMs <= 0) return "Just now";
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `In ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return `In ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
