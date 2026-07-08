import { vi, describe, it, expect, beforeEach } from "vitest";

const mockRun = vi.fn();
const mockAll = vi.fn();
vi.mock("../../db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: mockRun, all: mockAll })),
  })),
}));
vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "usage-uuid") }));

import { recordUsage, readTodayUsage, estimateTokens } from "../usage";

describe("estimateTokens", () => {
  it("returns ceil(len/4)", () => {
    expect(estimateTokens("hello")).toBe(2); // ceil(5/4)
    expect(estimateTokens("hello world!")).toBe(3); // ceil(12/4)
    expect(estimateTokens("")).toBe(0);
  });
});

describe("recordUsage", () => {
  beforeEach(() => mockRun.mockReset());

  it("inserts a row with correct columns", () => {
    recordUsage("user-1", {
      promptClass: "triage_cleanup",
      inputTokens: 100,
      outputTokens: 50,
      model: "claude-haiku-4-5-20251001",
    });
    expect(mockRun).toHaveBeenCalledWith(
      "usage-uuid",
      "user-1",
      "triage_cleanup",
      100,
      50,
      "claude-haiku-4-5-20251001",
    );
  });

  it("records usage without error on normal call", () => {
    mockRun.mockImplementation(() => {});
    expect(() =>
      recordUsage("user-1", {
        promptClass: "make_startable",
        inputTokens: 10,
        outputTokens: 5,
        model: "claude-haiku-4-5-20251001",
      }),
    ).not.toThrow();
    expect(mockRun).toHaveBeenCalled();
  });
});

describe("readTodayUsage", () => {
  it("aggregates rows correctly", () => {
    mockAll.mockReturnValue([
      { prompt_class: "triage_cleanup", input: 200, output: 100, count: 2 },
      { prompt_class: "make_startable", input: 50, output: 25, count: 1 },
    ]);
    const r = readTodayUsage("user-1");
    expect(r.totalRequests).toBe(3);
    expect(r.totalInputTokens).toBe(250);
    expect(r.totalOutputTokens).toBe(125);
    expect(r.byPromptClass["triage_cleanup"]?.requests).toBe(2);
  });

  it("returns zeros when no rows", () => {
    mockAll.mockReturnValue([]);
    const r = readTodayUsage("user-1");
    expect(r.totalRequests).toBe(0);
  });
});
