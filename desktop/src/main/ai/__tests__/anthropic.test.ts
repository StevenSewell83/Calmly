import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock @anthropic-ai/sdk
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, msg: string) { super(msg); this.status = status; }
  }
  class APIConnectionTimeoutError extends Error {
    constructor() { super("Timeout"); }
  }
  class APIConnectionError extends Error {
    constructor() { super("Connection error"); }
  }
  return {
    default: class Anthropic {
      messages = { create: mockCreate };
      static APIError = APIError;
      static APIConnectionTimeoutError = APIConnectionTimeoutError;
      static APIConnectionError = APIConnectionError;
    },
    APIError,
    APIConnectionTimeoutError,
    APIConnectionError,
  };
});

import { AnthropicProvider } from "../providers/anthropic";
import Anthropic from "@anthropic-ai/sdk";

describe("AnthropicProvider.complete", () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider("sk-ant-test");
    mockCreate.mockReset();
  });

  it("returns ok:true with text on success", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: '{"title":"Buy milk"}' }] });
    const r = await provider.complete("system", "user");
    expect(r).toEqual({ ok: true, value: '{"title":"Buy milk"}' });
  });

  it("returns invalid_response when no text block", async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const r = await provider.complete("system", "user");
    expect(r).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  });

  it("categorizes 401 as auth error", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockCreate.mockRejectedValue(new (Anthropic.APIError as any)(401, "Unauthorized"));
    const r = await provider.complete("system", "user");
    expect(r).toMatchObject({ ok: false, error: { kind: "auth" } });
  });

  it("categorizes 429 as quota error", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockCreate.mockRejectedValue(new (Anthropic.APIError as any)(429, "Rate limit"));
    const r = await provider.complete("system", "user");
    expect(r).toMatchObject({ ok: false, error: { kind: "quota" } });
  });

  it("categorizes timeout error", async () => {
    mockCreate.mockRejectedValue(new Anthropic.APIConnectionTimeoutError({ message: "Timeout" }));
    const r = await provider.complete("system", "user");
    expect(r).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("categorizes connection error as network", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockCreate.mockRejectedValue(new (Anthropic.APIConnectionError as any)());
    const r = await provider.complete("system", "user");
    expect(r).toMatchObject({ ok: false, error: { kind: "network" } });
  });

  it("categorizes unknown error", async () => {
    mockCreate.mockRejectedValue(new Error("something else"));
    const r = await provider.complete("system", "user");
    expect(r).toMatchObject({ ok: false, error: { kind: "unknown" } });
  });
});
