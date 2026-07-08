/**
 * AI v1 integration: make_startable action
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
vi.mock("../../../src/main/db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: mockDbRun,
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  })),
}));

vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "ms-suggestion-001") }));

import { runAI } from "../../../src/main/ai";

describe("make_startable integration", () => {
  const mockResult = {
    firstStep: "Open last year's proposal",
    steps: ["List 5 changes", "Block 90 min"],
  };

  beforeEach(() => {
    mockComplete.mockReset();
    mockDbRun.mockReset();
    mockComplete.mockResolvedValue({
      ok: true,
      value: JSON.stringify(mockResult),
    });
  });

  it("returns firstStep and steps", async () => {
    const r = await runAI(
      {
        action: "make_startable",
        payload: { title: "Draft proposal", notes: "" },
      },
      { ownerType: "task", ownerId: "task-abc" },
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.value.result as typeof mockResult;
    expect(result.firstStep).toBe("Open last year's proposal");
    expect(result.steps).toHaveLength(2);
  });

  it("records suggestion with ownerType and ownerId", async () => {
    await runAI(
      {
        action: "make_startable",
        payload: { title: "Draft proposal" },
      },
      { ownerType: "task", ownerId: "task-abc" },
    );

    expect(mockDbRun).toHaveBeenCalledWith(
      "ms-suggestion-001",
      "task",
      "task-abc",
      "claude-haiku-4-5-20251001",
      "make_startable",
      JSON.stringify(mockResult),
    );
  });

  it("steps are capped at 5 by schema validation", async () => {
    mockComplete.mockResolvedValue({
      ok: true,
      value: JSON.stringify({
        firstStep: "Start",
        steps: ["a", "b", "c", "d", "e", "f", "g"], // 7 steps — exceeds max
      }),
    });
    const r = await runAI({
      action: "make_startable",
      payload: { title: "Task" },
    });
    // Zod's .max(5) should reject — returns invalid_response
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid_response");
  });
});
