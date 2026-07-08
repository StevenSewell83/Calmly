import type { InboxItem } from "../../../preload/api-types";
import { useResource, type UseResourceReturn } from "../../hooks/useResource";

export interface InboxListData {
  items: InboxItem[];
}

// Single hook that owns the inbox-list fetch and exposes a refresh
// thunk so per-row mutations (snooze / skip / capture) can drop an
// item without round-tripping through the parent page.
export function useInboxList(): UseResourceReturn<InboxListData> {
  return useResource<InboxListData>(async () => {
    const r = await window.calmly.inbox.list();
    if (!r.ok) return { kind: "signed-out" };
    return { kind: "ok", data: { items: r.items } };
  }, []);
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
