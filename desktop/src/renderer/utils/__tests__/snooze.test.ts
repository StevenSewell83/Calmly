import { describe, it, expect } from "vitest";
import {
  snoozeOneHour,
  snoozeTomorrowMorning,
  snoozeNextWeek,
} from "../snooze";

// Fixed reference: Friday 2024-03-08 23:30:00 local (just before DST spring-forward)
// DST in US starts Sun 2024-03-10 at 2am — "tomorrow morning" from Fri evening should be 8am Sat
const FRI_NIGHT = new Date("2024-03-08T23:30:00").getTime();
// Sunday just before spring-forward: "tomorrow morning" should be 8am Mon (post-DST)
const SAT_NIGHT_PRE_DST = new Date("2024-03-09T23:30:00").getTime();

describe("snoozeOneHour", () => {
  it("adds exactly 1 hour", () => {
    const now = 1_000_000;
    expect(snoozeOneHour(now)).toBe(now + 3_600_000);
  });

  it("defaults to Date.now() when no arg given", () => {
    const before = Date.now();
    const result = snoozeOneHour();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(result).toBeLessThanOrEqual(after + 3_600_000);
  });
});

describe("snoozeTomorrowMorning", () => {
  it("returns 8am the next calendar day", () => {
    const result = new Date(snoozeTomorrowMorning(FRI_NIGHT));
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    // Should be the next day (Saturday)
    const nowDay = new Date(FRI_NIGHT).getDate();
    expect(result.getDate()).toBe(nowDay + 1);
  });

  it("is still 8am after DST spring-forward (Sun→Mon)", () => {
    const result = new Date(snoozeTomorrowMorning(SAT_NIGHT_PRE_DST));
    expect(result.getHours()).toBe(8);
    expect(result.getMinutes()).toBe(0);
  });

  it("result is in the future", () => {
    expect(snoozeTomorrowMorning(FRI_NIGHT)).toBeGreaterThan(FRI_NIGHT);
  });
});

describe("snoozeNextWeek", () => {
  it("adds exactly 7 days in ms", () => {
    const now = 1_000_000_000;
    expect(snoozeNextWeek(now)).toBe(now + 7 * 24 * 3_600_000);
  });
});
