export function snoozeOneHour(now: number = Date.now()): number {
  return now + 60 * 60 * 1000;
}

export function snoozeTomorrowMorning(now: number = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export function snoozeNextWeek(now: number = Date.now()): number {
  return now + 7 * 24 * 60 * 60 * 1000;
}
