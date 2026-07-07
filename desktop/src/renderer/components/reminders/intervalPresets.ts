// Shared interval preset list — used by both the per-task ReminderRuleEditor
// and the Settings → Reminders default-profile page, so the two surfaces
// always offer the same vocabulary of intervals.
export interface IntervalPreset {
  label: string;
  seconds: number;
}

export const INTERVAL_PRESETS: IntervalPreset[] = [
  { label: "10m", seconds: 600 },
  { label: "30m", seconds: 1800 },
  { label: "1h", seconds: 3600 },
  { label: "3h", seconds: 10800 },
  { label: "Daily", seconds: 86400 },
];

export function formatInterval(seconds: number): string {
  const preset = INTERVAL_PRESETS.find((p) => p.seconds === seconds);
  if (preset) return preset.label;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
