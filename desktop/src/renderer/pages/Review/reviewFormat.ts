// Pure formatters used by the Review page chrome. Lives outside the
// component file so react-refresh / only-export-components stays happy
// when SummaryStrip is hot-reloaded.

// 'YYYY-MM-DD' → "Thu, Apr 30". Browsers don't infer locale from the
// dash format reliably, so build the Date with explicit components.
export function formatDateLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Sum-of-focus-session-ms → "1h 25m focused" / "12m focused". Returns
// null for zero-or-negative so the caller can render an em-dash.
export function formatFocusedMs(ms: number): string | null {
  if (ms <= 0) return null;
  const total = Math.round(ms / 60_000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m focused`;
  if (minutes === 0) return `${hours}h focused`;
  return `${hours}h ${minutes}m focused`;
}
