/**
 * AI v1 integration: brain_dump_split action
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const mockComplete = vi.fn();
vi.mock("../../../src/main/ai/providers/anthropic", () => ({
  AnthropicProvider: class {
    complete(...args: unknown[]) { return mockComplete(...args); }
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
    prepare: vi.fn(() => ({ run: mockDbRun, get: vi.fn(), all: vi.fn(() => []) })),
  })),
}));

vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "bd-suggestion-001") }));

import { runAI } from "../../../src/main/ai";

describe("brain_dump_split integration", () => {
  const fourItems = {
    tasks: [
      { title: "Buy groceries" },
      { title: "Call dentist" },
      { title: "Reply to Sarah" },
      { title: "Car oil change" },
    ],
  };

  beforeEach(() => {
    mockComplete.mockReset();
    mockDbRun.mockReset();
    mockComplete.mockResolvedValue({ ok: true, value: JSON.stringify(fourItems) });
  });

  it("returns 4 candidate tasks", async () => {
    const r = await runAI({
      action: "brain_dump_split",
      payload: { text: "buy groceries\ncall dentist\nreply to Sarah\ncar oil change" },
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.value.result as typeof fourItems;
    expect(result.tasks).toHaveLength(4);
    expect(result.tasks[0]!.title).toBe("Buy groceries");
  });

  it("schema rejects tasks array exceeding 20", async () => {
    const tooMany = { tasks: Array.from({ length: 21 }, (_, i) => ({ title: `Task ${i}` })) };
    mockComplete.mockResolvedValue({ ok: true, value: JSON.stringify(tooMany) });
    const r = await runAI({ action: "brain_dump_split", payload: { text: "lots of stuff" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid_response");
  });

  it("records pending suggestion", async () => {
    await runAI({ action: "brain_dump_split", payload: { text: "dump" } });
    expect(mockDbRun).toHaveBeenCalledWith(
      "bd-suggestion-001",
      null,
      null,
      "claude-haiku-4-5-20251001",
      "brain_dump_split",
      JSON.stringify(fourItems),
    );
  });
});
