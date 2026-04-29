import { describe, expect, it } from "vitest";
import type { InboxItem } from "../../../../preload/api-types";
import {
  snoozeNextWeek,
  snoozeOneHour,
  snoozeTomorrowMorning,
  sortInboxItems,
} from "../useInboxList";

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: "x",
    raw_text: "x",
    source: "desktop",
    created_at: 0,
    resolved_at: null,
    snoozed_until: null,
    ...overrides,
  };
}

describe("sortInboxItems", () => {
  const a = item({ id: "a", source: "desktop", created_at: 100 });
  const b = item({ id: "b", source: "telegram-text", created_at: 200 });
  const c = item({ id: "c", source: "desktop", created_at: 50 });

  it("newest sorts created_at descending", () => {
    expect(sortInboxItems([a, b, c], "newest").map((i) => i.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("oldest sorts created_at ascending", () => {
    expect(sortInboxItems([a, b, c], "oldest").map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("source buckets by source then newest-within", () => {
    expect(sortInboxItems([a, b, c], "source").map((i) => i.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("does not mutate the input", () => {
    const arr = [a, b, c];
    sortInboxItems(arr, "newest");
    expect(arr.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("snooze presets", () => {
  it("1h adds exactly 3600s", () => {
    expect(snoozeOneHour(1_000)).toBe(1_000 + 3_600_000);
  });

  it("tomorrow lands on next-day 8am local", () => {
    // 2026-04-30T15:00:00Z; next-day 8am local should be 2026-05-01 08:00 local.
    const now = new Date(Date.UTC(2026, 3, 30, 15, 0, 0)).getTime();
    const target = new Date(snoozeTomorrowMorning(now));
    expect(target.getDate()).toBe(new Date(now).getDate() + 1);
    expect(target.getHours()).toBe(8);
    expect(target.getMinutes()).toBe(0);
  });

  it("next week is 7 days out", () => {
    expect(snoozeNextWeek(0)).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
