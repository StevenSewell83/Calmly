import { useCallback, useEffect, useState } from "react";
import type { InboxItem } from "../../../preload/api-types";

export type InboxListState =
  | { kind: "loading" }
  | { kind: "ready"; items: InboxItem[] }
  | { kind: "signed-out" }
  | { kind: "error"; message: string };

// Single hook that owns the inbox-list fetch and exposes a refresh
// thunk so per-row mutations (snooze / skip / capture) can drop an
// item without round-tripping through the parent page.
export function useInboxList(): {
  state: InboxListState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<InboxListState>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const r = await window.calmly.inbox.list();
      if (!r.ok) {
        setState({ kind: "signed-out" });
        return;
      }
      setState({ kind: "ready", items: r.items });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, refresh };
}

export type InboxSortMode = "newest" | "oldest" | "source";

// Pure renderer-side sort. SQL keeps the IPC simple by returning
// newest-first; the user toggle re-shuffles in memory. 'source' is a
// secondary sort: bucket by source label, then newest-first within.
export function sortInboxItems(
  items: InboxItem[],
  mode: InboxSortMode,
): InboxItem[] {
  const copy = items.slice();
  if (mode === "newest") {
    copy.sort((a, b) => b.created_at - a.created_at);
    return copy;
  }
  if (mode === "oldest") {
    copy.sort((a, b) => a.created_at - b.created_at);
    return copy;
  }
  // source: stable bucket order, newest within each bucket.
  copy.sort((a, b) => {
    const s = a.source.localeCompare(b.source);
    if (s !== 0) return s;
    return b.created_at - a.created_at;
  });
  return copy;
}

// Snooze preset durations. Returns absolute unix-ms targets so the
// IPC contract stays tied to a timestamp, not a human label.
export function snoozeOneHour(now: number): number {
  return now + 60 * 60 * 1000;
}

export function snoozeTomorrowMorning(now: number): number {
  // 8am local time the day after `now`.
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

export function snoozeNextWeek(now: number): number {
  return now + 7 * 24 * 60 * 60 * 1000;
}
