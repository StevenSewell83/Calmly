/**
 * AI v1 integration: failure modes
 *
 * Tests all documented failure paths: missing key, 401, 429, timeout, network, invalid response.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockComplete, mockGet, mockHas } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
  mockGet: vi.fn(),
  mockHas: vi.fn(),
}));

vi.mock("../../../src/main/ai/providers/anthropic", () => ({
  AnthropicProvider: class {
    complete(...args: unknown[]) {
      return mockComplete(...args);
    }
  },
}));

vi.mock("../../../src/main/security/secretStore", () => ({
  secretStore: {
    get: mockGet,
    has: mockHas,
  },
}));

vi.mock("../../../src/main/ai/rateLimiter", () => ({
  globalRateLimiter: { check: () => 0, onQuotaError: () => {} },
}));

vi.mock("../../../src/main/db", () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
  })),
}));

vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "fail-id") }));

import { runAI } from "../../../src/main/ai";

describe("AI failure modes", () => {
  beforeEach(() => {
    mockComplete.mockReset();
    mockGet.mockReturnValue("sk-ant-test");
    mockHas.mockReturnValue(true);
  });

  it("missing key → auth error", async () => {
    mockGet.mockReturnValue(null);
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "thing" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("auth");
  });

  it("401 from provider → auth error", async () => {
    mockComplete.mockResolvedValue({ ok: false, error: { kind: "auth" } });
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "thing" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("auth");
  });

  it("429 from provider → quota error", async () => {
    mockComplete.mockResolvedValue({ ok: false, error: { kind: "quota" } });
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "thing" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("quota");
  });

  it("timeout → timeout error", async () => {
    mockComplete.mockResolvedValue({ ok: false, error: { kind: "timeout" } });
    const r = await runAI({
      action: "make_startable",
      payload: { title: "Task" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("timeout");
  });

  it("network error → network error", async () => {
    mockComplete.mockResolvedValue({ ok: false, error: { kind: "network" } });
    const r = await runAI({
      action: "brain_dump_split",
      payload: { text: "stuff" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("network");
  });

  it("invalid JSON from provider → invalid_response", async () => {
    mockComplete.mockResolvedValue({ ok: true, value: "not json at all" });
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "thing" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid_response");
  });

  it("schema mismatch from provider → invalid_response", async () => {
    // Missing required fields
    mockComplete.mockResolvedValue({
      ok: true,
      value: JSON.stringify({ wrong_field: "oops" }),
    });
    const r = await runAI({
      action: "triage_cleanup",
      payload: { rawText: "thing" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("invalid_response");
  });

  it("unknown action → unknown error", async () => {
    const r = await runAI({ action: "unknown_action" as never, payload: {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("unknown");
  });
});
