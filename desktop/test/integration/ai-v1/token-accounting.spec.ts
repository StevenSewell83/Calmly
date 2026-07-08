/**
 * AI v1 integration: token accounting
 *
 * Verifies that successful runAI calls record usage rows.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const mockComplete = vi.fn();
vi.mock("../../../src/main/ai/providers/anthropic", () => ({
  AnthropicProvider: class {
    complete(...args: unknown[]) {
      return mockComplete(...args);
    }
  },
}));

vi.mock("../../../src/main/security/secretStore", () => ({
  secretStore: {
    get: vi.fn(() => "sk-ant-test"),
    has: vi.fn(() => true),
  },
}));

const mockDbRun = vi.fn();
const mockDbAll = vi.fn();
vi.mock("../../../src/main/db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: mockDbRun, get: vi.fn(), all: mockDbAll })),
  })),
}));

vi.mock("crypto", () => ({
  randomUUID: vi
    .fn()
    .mockReturnValueOnce("sug-1")
    .mockReturnValueOnce("usage-1")
    .mockReturnValue("other-id"),
}));

import { runAI } from "../../../src/main/ai";
import { readTodayUsage } from "../../../src/main/ai/usage";

describe("token accounting", () => {
  beforeEach(() => {
    mockComplete.mockReset();
    mockDbRun.mockReset();
    mockDbAll.mockReset();
    mockComplete.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        type: "task",
        title: "Cleaned title",
        nextAction: "First step",
      }),
    });
  });

  it("records a usage row after successful runAI with userId", async () => {
    await runAI(
      { action: "triage_cleanup", payload: { rawText: "thing" } },
      { userId: "user-123" },
    );
    // mockDbRun should be called twice: once for suggestion, once for usage
    expect(mockDbRun).toHaveBeenCalledTimes(2);
    const usageCall = mockDbRun.mock.calls[1]!;
    expect(usageCall[1]).toBe("user-123"); // userId
    expect(usageCall[2]).toBe("triage_cleanup"); // prompt_class
    expect(typeof usageCall[3]).toBe("number"); // input_tokens
    expect(typeof usageCall[4]).toBe("number"); // output_tokens
    expect(usageCall[3]).toBeGreaterThan(0); // non-zero input
  });

  it("does not record usage row without userId", async () => {
    await runAI({ action: "triage_cleanup", payload: { rawText: "thing" } });
    // Only 1 call: the suggestion insert
    expect(mockDbRun).toHaveBeenCalledTimes(1);
  });

  it("readTodayUsage aggregates correctly", () => {
    mockDbAll.mockReturnValue([
      { prompt_class: "triage_cleanup", input: 300, output: 150, count: 3 },
    ]);
    const r = readTodayUsage("user-123");
    expect(r.totalRequests).toBe(3);
    expect(r.totalInputTokens).toBe(300);
    expect(r.byPromptClass["triage_cleanup"]?.requests).toBe(3);
  });
});
