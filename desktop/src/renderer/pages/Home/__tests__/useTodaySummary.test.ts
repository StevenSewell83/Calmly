import { describe, expect, it } from "vitest";
import type {
  EventTodayItem,
  TaskTodayItem,
} from "../../../../preload/api-types";
import { buildTodayList, pickNextItem, pickNowTask } from "../useTodaySummary";

const T0 = Date.UTC(2026, 3, 30, 9, 0, 0);
const ONE_HR = 3_600_000;

function task(overrides: Partial<TaskTodayItem>): TaskTodayItem {
  return {
    id: "t",
    title: "Task",
    status: "open",
    due_at: null,
    updated_at: T0,
    ...overrides,
  };
}

function ev(overrides: Partial<EventTodayItem>): EventTodayItem {
  return {
    id: "e",
    title: "Event",
    start_at: T0 + ONE_HR,
    end_at: T0 + 2 * ONE_HR,
    ...overrides,
  };
}

describe("pickNowTask", () => {
  it("returns the first in_progress task, or null when none", () => {
    expect(pickNowTask([])).toBeNull();
    expect(pickNowTask([task({ status: "open" })])).toBeNull();
    const focused = task({ id: "focused", status: "in_progress" });
    expect(pickNowTask([task({}), focused])).toBe(focused);
  });
});

describe("pickNextItem", () => {
  it("skips in_progress (that's Now, not Next)", () => {
    const result = pickNextItem(
      [task({ id: "now", status: "in_progress", due_at: T0 + ONE_HR })],
      [],
      T0,
    );
    expect(result).toBeNull();
  });

  it("ignores past timestamps", () => {
    const result = pickNextItem(
      [task({ id: "old", status: "open", due_at: T0 - ONE_HR })],
      [ev({ id: "passed", start_at: T0 - ONE_HR, end_at: T0 - 1 })],
      T0,
    );
    expect(result).toBeNull();
  });

  it("picks the earliest of upcoming task / event", () => {
    const earlierEvent = ev({ id: "early-evt", start_at: T0 + ONE_HR });
    const laterTask = task({
      id: "late-task",
      status: "open",
      due_at: T0 + 4 * ONE_HR,
    });
    const result = pickNextItem([laterTask], [earlierEvent], T0);
    expect(result).toEqual({ kind: "event", event: earlierEvent });

    const laterEvent = ev({ id: "late-evt", start_at: T0 + 4 * ONE_HR });
    const earlierTask = task({
      id: "early-task",
      status: "open",
      due_at: T0 + ONE_HR,
    });
    const result2 = pickNextItem([earlierTask], [laterEvent], T0);
    expect(result2).toEqual({ kind: "task", task: earlierTask });
  });

  it("ignores tasks with no due_at when ranking Next", () => {
    const noDate = task({ id: "loose", status: "open", due_at: null });
    const dated = ev({ id: "evt", start_at: T0 + 2 * ONE_HR });
    const result = pickNextItem([noDate], [dated], T0);
    expect(result).toEqual({ kind: "event", event: dated });
  });
});

describe("buildTodayList", () => {
  it("merges tasks + events, sorted by anchor time", () => {
    const morning = ev({ id: "m", start_at: T0 });
    const afternoon = task({
      id: "a",
      status: "open",
      due_at: T0 + 4 * ONE_HR,
    });
    const noon = task({
      id: "n",
      status: "open",
      due_at: T0 + 2 * ONE_HR,
    });
    const items = buildTodayList([afternoon, noon], [morning]);
    expect(
      items.map((i) => (i.kind === "task" ? i.task.id : i.event.id)),
    ).toEqual(["m", "n", "a"]);
  });

  it("anchors a no-due in_progress task by its updated_at", () => {
    const anchor = T0 + 30 * 60_000;
    const focused = task({
      id: "focused",
      status: "in_progress",
      due_at: null,
      updated_at: anchor,
    });
    const later = ev({ id: "evt", start_at: T0 + 2 * ONE_HR });
    const items = buildTodayList([focused], [later]);
    expect(items[0]!.kind === "task" && items[0]!.task.id).toBe("focused");
    expect(items[0]!.at).toBe(anchor);
  });
});
