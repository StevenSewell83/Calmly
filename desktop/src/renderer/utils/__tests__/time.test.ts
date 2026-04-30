import { describe, it, expect } from "vitest";
import {
  formatClock,
  formatClockParts,
  formatRelativePast,
  formatRelativeFuture,
} from "../time";

// Fixed reference: 2024-01-15 14:05:00 UTC
const BASE = new Date("2024-01-15T14:05:00Z").getTime();

describe("formatClockParts", () => {
  it("returns h12 and meridiem parts", () => {
    // 14:05 UTC → local depends on TZ; use a known local time
    const noon = new Date("2024-01-15T12:00:00").getTime(); // local noon
    const { hm, meridiem } = formatClockParts(noon);
    expect(hm).toBe("12:00");
    expect(meridiem).toBe("pm");
  });

  it("handles midnight (12:00 am)", () => {
    const midnight = new Date("2024-01-15T00:00:00").getTime();
    const { hm, meridiem } = formatClockParts(midnight);
    expect(hm).toBe("12:00");
    expect(meridiem).toBe("am");
  });

  it("handles 1:05 pm", () => {
    const t = new Date("2024-01-15T13:05:00").getTime();
    const { hm, meridiem } = formatClockParts(t);
    expect(hm).toBe("1:05");
    expect(meridiem).toBe("pm");
  });
});

describe("formatClock", () => {
  it("joins parts with space", () => {
    const t = new Date("2024-01-15T09:30:00").getTime();
    expect(formatClock(t)).toBe("9:30 am");
  });
});

describe("formatRelativePast", () => {
  const now = BASE;

  it("returns 'Just now' for 0ms diff", () => {
    expect(formatRelativePast(now, now)).toBe("Just now");
  });

  it("returns 'Just now' for 30s ago", () => {
    expect(formatRelativePast(now - 30_000, now)).toBe("Just now");
  });

  it("returns minutes for 5m ago", () => {
    expect(formatRelativePast(now - 5 * 60_000, now)).toBe("5m ago");
  });

  it("returns hours for 2h ago", () => {
    expect(formatRelativePast(now - 2 * 3_600_000, now)).toBe("2h ago");
  });

  it("returns days for 3d ago", () => {
    expect(formatRelativePast(now - 3 * 86_400_000, now)).toBe("3d ago");
  });

  it("returns weeks for 2w ago", () => {
    expect(formatRelativePast(now - 14 * 86_400_000, now)).toBe("2w ago");
  });

  it("clamps future timestamps to 'Just now'", () => {
    expect(formatRelativePast(now + 60_000, now)).toBe("Just now");
  });
});

describe("formatRelativeFuture", () => {
  const now = BASE;

  it("returns 'Just now' for past/present", () => {
    expect(formatRelativeFuture(now - 1000, now)).toBe("Just now");
    expect(formatRelativeFuture(now, now)).toBe("Just now");
  });

  it("returns singular minute", () => {
    expect(formatRelativeFuture(now + 60_000, now)).toBe("In 1 minute");
  });

  it("returns plural minutes", () => {
    expect(formatRelativeFuture(now + 5 * 60_000, now)).toBe("In 5 minutes");
  });

  it("returns singular hour at 60+ minutes", () => {
    expect(formatRelativeFuture(now + 3_600_000, now)).toBe("In 1 hour");
  });

  it("returns plural hours", () => {
    expect(formatRelativeFuture(now + 3 * 3_600_000, now)).toBe("In 3 hours");
  });
});
