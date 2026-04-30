import { describe, expect, it } from "vitest";
import {
  chipThisWeek,
  chipToday,
  chipTomorrow,
  endOfDay,
} from "../triageDates";

// Each chip lands on end-of-day (23:59:59.999) in the local zone so a
// task tagged 'Today' won't slip off the day list at midnight UTC.

describe("endOfDay", () => {
  it("rolls forward to 23:59:59.999 same day for offset 0", () => {
    // 2026-04-30T10:30:00 local
    const now = new Date(2026, 3, 30, 10, 30, 0).getTime();
    const out = new Date(endOfDay(now, 0));
    expect(out.getDate()).toBe(30);
    expect(out.getMonth()).toBe(3);
    expect(out.getHours()).toBe(23);
    expect(out.getMinutes()).toBe(59);
    expect(out.getSeconds()).toBe(59);
    expect(out.getMilliseconds()).toBe(999);
  });

  it("crosses month boundaries cleanly", () => {
    // 2026-04-30 → +2 = 2026-05-02
    const now = new Date(2026, 3, 30, 9, 0, 0).getTime();
    const out = new Date(endOfDay(now, 2));
    expect(out.getMonth()).toBe(4);
    expect(out.getDate()).toBe(2);
  });
});

describe("chipToday", () => {
  it("matches endOfDay(now, 0)", () => {
    const now = new Date(2026, 3, 30, 8, 0, 0).getTime();
    expect(chipToday(now)).toBe(endOfDay(now, 0));
  });
});

describe("chipTomorrow", () => {
  it("returns end-of-day +1, crossing month boundaries", () => {
    // 2026-04-30 + 1 day = 2026-05-01 (April only has 30 days).
    const now = new Date(2026, 3, 30, 8, 0, 0).getTime();
    const out = new Date(chipTomorrow(now));
    expect(out.getMonth()).toBe(4);
    expect(out.getDate()).toBe(1);
    expect(out.getHours()).toBe(23);
  });
});

describe("chipThisWeek", () => {
  it("lands on Friday end-of-day from a Tuesday", () => {
    // 2026-04-28 (Tuesday) + 3 = 2026-05-01 (Friday).
    const tue = new Date(2026, 3, 28, 9, 0, 0);
    expect(tue.getDay()).toBe(2);
    const out = new Date(chipThisWeek(tue.getTime()));
    expect(out.getDay()).toBe(5);
    expect(out.getMonth()).toBe(4);
    expect(out.getDate()).toBe(1);
  });

  it("stays on Friday when today is Friday", () => {
    // 2026-05-01 is a Friday.
    const fri = new Date(2026, 4, 1, 9, 0, 0);
    expect(fri.getDay()).toBe(5);
    const out = new Date(chipThisWeek(fri.getTime()));
    expect(out.getDay()).toBe(5);
    expect(out.getMonth()).toBe(4);
    expect(out.getDate()).toBe(1);
  });

  it("rolls to next Friday from a Saturday", () => {
    // 2026-05-02 (Saturday) → next Friday is 2026-05-08.
    const sat = new Date(2026, 4, 2, 9, 0, 0);
    expect(sat.getDay()).toBe(6);
    const out = new Date(chipThisWeek(sat.getTime()));
    expect(out.getDay()).toBe(5);
    expect(out.getMonth()).toBe(4);
    expect(out.getDate()).toBe(8);
  });
});
