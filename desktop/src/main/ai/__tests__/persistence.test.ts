import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock DB
const mockRun = vi.fn();
const mockGet = vi.fn();
const mockPrepare = vi.fn(() => ({ run: mockRun, get: mockGet }));
const mockDb = { prepare: mockPrepare };

vi.mock("../../db", () => ({ getDb: vi.fn(() => mockDb) }));

// Mock crypto to get predictable UUIDs
vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "test-uuid-1234") }));

import { recordPending, recordOutcome } from "../persistence";

describe("recordPending", () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockPrepare.mockClear();
  });

  it("inserts a row and returns the id", () => {
    const id = recordPending({
      model: "claude-haiku-4-5-20251001",
      promptClass: "triage_cleanup",
      suggestionJson: { title: "Buy milk" },
    });
    expect(id).toBe("test-uuid-1234");
    expect(mockRun).toHaveBeenCalledWith(
      "test-uuid-1234",
      null,
      null,
      "claude-haiku-4-5-20251001",
      "triage_cleanup",
      JSON.stringify({ title: "Buy milk" }),
    );
  });

  it("passes ownerType and ownerId when provided", () => {
    recordPending({
      ownerType: "task",
      ownerId: "task-abc",
      model: "claude-haiku-4-5-20251001",
      promptClass: "make_startable",
      suggestionJson: { firstStep: "Open laptop" },
    });
    expect(mockRun).toHaveBeenCalledWith(
      "test-uuid-1234",
      "task",
      "task-abc",
      "claude-haiku-4-5-20251001",
      "make_startable",
      JSON.stringify({ firstStep: "Open laptop" }),
    );
  });
});

describe("recordOutcome", () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockPrepare.mockClear();
  });

  it("updates outcome to accepted", () => {
    recordOutcome("test-uuid-1234", "accepted");
    expect(mockRun).toHaveBeenCalledWith("accepted", "test-uuid-1234");
  });

  it("updates outcome to rejected", () => {
    recordOutcome("test-uuid-1234", "rejected");
    expect(mockRun).toHaveBeenCalledWith("rejected", "test-uuid-1234");
  });

  it("stores editedJson for edited outcome", () => {
    recordOutcome("test-uuid-1234", "edited", { title: "Fixed title" });
    expect(mockRun).toHaveBeenCalledWith(
      "edited",
      JSON.stringify({ title: "Fixed title" }),
      "test-uuid-1234",
    );
  });
});
