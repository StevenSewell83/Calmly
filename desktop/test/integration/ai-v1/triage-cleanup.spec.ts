/**
 * AI v1 integration: triage_cleanup action
 *
 * Tests the runAI dispatcher end-to-end with a mocked AnthropicProvider.
 * No real API calls are made.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the AnthropicProvider so no real HTTP calls are made
const mockComplete = vi.fn();
vi.mock("../../../src/main/ai/providers/anthropic", () => ({
  AnthropicProvider: class {
    complete(...args: unknown[]) {
      return mockComplete(...args);
    }
  },
}));

// Mock secretStore
vi.mock("../../../src/main/security/secretStore", () => ({
  secretStore: {
    get: vi.fn(() => "sk-ant-test"),
    has: vi.fn(() => true),
  },
}));

// Mock DB for persistence
const mockDbRun = vi.fn();
const mockDbGet = vi.fn();
vi.mock("../../../src/main/db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: mockDbRun,
      get: mockDbGet,
      all: vi.fn(() => []),
    })),
  })),
}));

vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "suggestion-id-001") }));

import { runAI } from "../../../src/main/ai";
import { recordOutcome } from "../../../src/main/ai/persistence";

describe("triage_cleanup integration", () => {
  const cleanResponse = {
    type: "task",
    title: "Take car in for service",
    dueDate: "Friday",
    nextAction: "Call the dealership to book",
  };

  beforeEach(() => {
    mockComplete.mockReset();
    mockDbRun.mockReset();
    mockComplete.mockResolvedValue({
      ok: true,
      value: JSON.stringify(cleanResponse),
    });
  });

  it("happy path: returns suggestion with all fields", async () => {
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "thing about the car" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.action).toBe("triage_cleanup");
    const result = r.value.result as typeof cleanResponse;
    expect(result.type).toBe("task");
    expect(result.title).toBe("Take car in for service");
    expect(result.nextAction).toBe("Call the dealership to book");
  });

  it("records a pending suggestion row", async () => {
    await runAI({
      action: "triage_cleanup",
      payload: { rawText: "car thing" },
    });
    expect(mockDbRun).toHaveBeenCalledWith(
      "suggestion-id-001",
      null,
      null,
      "claude-haiku-4-5-20251001",
      "triage_cleanup",
      JSON.stringify(cleanResponse),
    );
  });

  it("returns suggestionId in response", async () => {
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "car" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.suggestionId).toBe("suggestion-id-001");
  });

  it("edited: recordOutcome stores edited payload", async () => {
    const editedResult = { ...cleanResponse, title: "Take car for oil change" };
    recordOutcome("suggestion-id-001", "edited", editedResult);
    expect(mockDbRun).toHaveBeenCalledWith(
      "edited",
      JSON.stringify(editedResult),
      "suggestion-id-001",
    );
  });

  it("rejected: recordOutcome marks rejected", async () => {
    recordOutcome("suggestion-id-001", "rejected");
    expect(mockDbRun).toHaveBeenCalledWith("rejected", "suggestion-id-001");
  });
});
