// Deterministic timestamps for the triage Due Date chips. All chips
// land at end-of-day (23:59:59.999) in the user's local zone so a
// task tagged 'Today' won't fall off the day list at midnight UTC.

export function endOfDay(now: number, dayOffset: number): number {
  const d = new Date(now);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function chipToday(now: number): number {
  return endOfDay(now, 0);
}

export function chipTomorrow(now: number): number {
  return endOfDay(now, 1);
}

// 'This Week' lands on Friday end-of-day. If today is already Sat/Sun,
// roll forward to next Friday; if today IS Friday, keep it.
export function chipThisWeek(now: number): number {
  const d = new Date(now);
  const dayOfWeek = d.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
  let offset: number;
  if (dayOfWeek <= 5) {
    offset = 5 - dayOfWeek;
  } else {
    // Saturday → next Friday is 6 days out.
    offset = 6;
  }
  return endOfDay(now, offset);
}
