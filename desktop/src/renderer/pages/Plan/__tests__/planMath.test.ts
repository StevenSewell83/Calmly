import { describe, expect, it } from "vitest";
import {
  buildSlotGuides,
  clampDurationMinutes,
  clampStartMinutes,
  detectOverlaps,
  formatBlockRange,
  formatGridTime,
  GRID_HOURS,
  gridMinutesToMs,
  gridStartMs,
  msToGridMinutes,
  pxToMinutes,
  PX_PER_HOUR,
  snapAndClampEndForStart,
  snapAndClampStartForDuration,
  snapMinutes,
} from "../planMath";

describe("snapMinutes", () => {
  it("rounds to nearest 15-min step", () => {
    expect(snapMinutes(0)).toBe(0);
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(22)).toBe(15);
    expect(snapMinutes(23)).toBe(30);
    expect(snapMinutes(45)).toBe(45);
  });

  it("handles negative inputs by snapping toward zero", () => {
    expect(snapMinutes(-7)).toBe(-0); // -7 rounds to 0 then * 15 = 0
    expect(snapMinutes(-8)).toBe(-15);
  });
});

describe("clampStartMinutes", () => {
  it("never returns less than 0", () => {
    expect(clampStartMinutes(-5)).toBe(0);
  });

  it("leaves room for the minimum block at the bottom", () => {
    const max = GRID_HOURS * 60 - 15;
    expect(clampStartMinutes(GRID_HOURS * 60 + 100)).toBe(max);
  });

  it("passes through valid values", () => {
    expect(clampStartMinutes(120)).toBe(120);
  });
});

describe("clampDurationMinutes", () => {
  it("enforces minimum 15 min", () => {
    expect(clampDurationMinutes(5, 0)).toBe(15);
  });

  it("enforces maximum 4 h", () => {
    expect(clampDurationMinutes(500, 0)).toBe(240);
  });

  it("clips against the grid bottom", () => {
    // Start at 60 min before bottom — only 60 min of room.
    const start = GRID_HOURS * 60 - 60;
    expect(clampDurationMinutes(180, start)).toBe(60);
  });
});

describe("pxToMinutes / minutesToPx round trip", () => {
  it("inverts cleanly at hour boundaries", () => {
    expect(pxToMinutes(PX_PER_HOUR)).toBe(60);
    expect(pxToMinutes(PX_PER_HOUR * 2)).toBe(120);
  });
});

describe("gridStartMs / msToGridMinutes / gridMinutesToMs", () => {
  it("anchors the grid at 6:00 AM local for the day in question", () => {
    // 2026-04-30 14:00 local → grid start = 2026-04-30 06:00 local.
    const noon = new Date(2026, 3, 30, 14, 0, 0).getTime();
    const start = gridStartMs(noon);
    const startDate = new Date(start);
    expect(startDate.getHours()).toBe(6);
    expect(startDate.getMinutes()).toBe(0);
    expect(startDate.getDate()).toBe(30);
  });

  it("round-trips minutes ↔ ms", () => {
    const anchor = new Date(2026, 3, 30, 9, 0, 0).getTime();
    const target = new Date(2026, 3, 30, 10, 30, 0).getTime();
    const minutes = msToGridMinutes(target, anchor);
    expect(minutes).toBe(4 * 60 + 30); // 4.5h after 6 AM
    expect(gridMinutesToMs(minutes, anchor)).toBe(target);
  });
});

describe("formatGridTime", () => {
  it("0 → 6:00 AM, 360 → 12:00 PM, 1020 → 11:00 PM", () => {
    expect(formatGridTime(0)).toBe("6:00 AM");
    expect(formatGridTime(360)).toBe("12:00 PM");
    expect(formatGridTime(1020)).toBe("11:00 PM");
  });

  it("pads minutes", () => {
    expect(formatGridTime(15)).toBe("6:15 AM");
    expect(formatGridTime(180 + 5)).toBe("9:05 AM");
  });
});

describe("formatBlockRange", () => {
  it("joins start and end with em-dash", () => {
    expect(formatBlockRange(0, 30)).toBe("6:00 AM – 6:30 AM");
    expect(formatBlockRange(360, 420)).toBe("12:00 PM – 1:00 PM");
  });
});

describe("buildSlotGuides", () => {
  it("emits one entry per 30-min boundary plus the trailing edge", () => {
    const guides = buildSlotGuides();
    expect(guides.length).toBe(GRID_HOURS * 2 + 1);
    expect(guides[0]).toMatchObject({ minutesFromStart: 0, isHour: true });
    expect(guides[1]).toMatchObject({ minutesFromStart: 30, isHour: false });
    expect(guides.at(-1)).toMatchObject({ minutesFromStart: GRID_HOURS * 60 });
  });

  it("only labels hour rows", () => {
    const guides = buildSlotGuides();
    const labeled = guides.filter((g) => g.label !== "");
    expect(labeled.every((g) => g.isHour)).toBe(true);
  });
});

describe("snapAndClampStartForDuration", () => {
  it("snaps and refuses to spill past the bottom", () => {
    const dur = 30;
    expect(snapAndClampStartForDuration(7, dur)).toBe(0);
    expect(snapAndClampStartForDuration(8, dur)).toBe(15);
    expect(
      snapAndClampStartForDuration(GRID_HOURS * 60 - 10, dur),
    ).toBe(GRID_HOURS * 60 - dur);
  });
});

describe("snapAndClampEndForStart", () => {
  it("enforces min duration relative to start", () => {
    expect(snapAndClampEndForStart(7, 30)).toBe(45); // 30+15
    expect(snapAndClampEndForStart(45, 30)).toBe(45);
  });

  it("enforces 4h cap", () => {
    expect(snapAndClampEndForStart(600, 60)).toBe(60 + 240);
  });

  it("never exceeds the grid bottom even when 4h would allow it", () => {
    // start near bottom, 1h before. 4h cap would allow start+240; bottom
    // is start+60. Bottom wins.
    const start = GRID_HOURS * 60 - 60;
    expect(snapAndClampEndForStart(GRID_HOURS * 60 + 200, start)).toBe(
      GRID_HOURS * 60,
    );
  });
});

describe("detectOverlaps", () => {
  it("returns empty for non-overlapping blocks", () => {
    const flags = detectOverlaps([
      { id: "a", startMs: 0, endMs: 30 },
      { id: "b", startMs: 30, endMs: 60 },
      { id: "c", startMs: 90, endMs: 120 },
    ]);
    expect(flags.size).toBe(0);
  });

  it("flags both members of a pairwise overlap", () => {
    const flags = detectOverlaps([
      { id: "a", startMs: 0, endMs: 60 },
      { id: "b", startMs: 30, endMs: 90 },
    ]);
    expect(flags.has("a")).toBe(true);
    expect(flags.has("b")).toBe(true);
  });

  it("treats touching edges as non-overlapping", () => {
    const flags = detectOverlaps([
      { id: "a", startMs: 0, endMs: 30 },
      { id: "b", startMs: 30, endMs: 60 },
    ]);
    expect(flags.size).toBe(0);
  });

  it("flags a block contained inside another", () => {
    const flags = detectOverlaps([
      { id: "outer", startMs: 0, endMs: 120 },
      { id: "inner", startMs: 30, endMs: 60 },
    ]);
    expect(flags.has("outer")).toBe(true);
    expect(flags.has("inner")).toBe(true);
  });

  it("does not mutate the input", () => {
    const arr = [
      { id: "b", startMs: 100, endMs: 200 },
      { id: "a", startMs: 0, endMs: 50 },
    ];
    detectOverlaps(arr);
    expect(arr.map((b) => b.id)).toEqual(["b", "a"]);
  });
});
