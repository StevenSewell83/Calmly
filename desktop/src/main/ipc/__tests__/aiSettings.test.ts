import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

// Mock electron before imports
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

// Mock secretStore
vi.mock("../../security/secretStore", () => ({
  secretStore: {
    has: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  isValidSecretKey: vi.fn(),
}));

// Mock safeStorage error class
vi.mock("../../security/safeStorage", () => ({
  EncryptionUnavailableError: class EncryptionUnavailableError extends Error {
    constructor() { super("EncryptionUnavailable"); this.name = "EncryptionUnavailableError"; }
  },
}));

// Mock DB
const mockDb = {
  prepare: vi.fn(),
};
vi.mock("../../db", () => ({ getDb: vi.fn(() => mockDb) }));

import { ipcMain } from "electron";
import { secretStore } from "../../security/secretStore";

// Capture registered handlers
type HandleFn = (e: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, HandleFn>();

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(ipcMain.handle).mockImplementation((ch: string, fn: any) => {
    handlers.set(ch, fn);
    return ipcMain;
  });
  // Lazy import so mocks are in place first
  return import("../aiSettings").then(({ registerAiSettingsIpc }) => registerAiSettingsIpc());
});

const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(null, ...args);

// ── ai:hasKey ──────────────────────────────────────────────────────────────

describe("ai:hasKey", () => {
  it("returns true when key is stored", () => {
    vi.mocked(secretStore.has).mockReturnValue(true);
    expect(call("ai:hasKey")).toBe(true);
  });

  it("returns false when no key is stored", () => {
    vi.mocked(secretStore.has).mockReturnValue(false);
    expect(call("ai:hasKey")).toBe(false);
  });
});

// ── ai:setKey ──────────────────────────────────────────────────────────────

describe("ai:setKey", () => {
  beforeEach(() => vi.mocked(secretStore.set).mockReset());

  it("rejects empty string", async () => {
    const r = await call("ai:setKey", "");
    expect(r).toMatchObject({ ok: false, error: "InvalidValue" });
  });

  it("rejects non-string payload", async () => {
    const r = await call("ai:setKey", 123);
    expect(r).toMatchObject({ ok: false, error: "InvalidValue" });
  });

  it("saves valid key and returns ok:true", async () => {
    vi.mocked(secretStore.set).mockImplementation(() => {});
    const r = await call("ai:setKey", "sk-ant-api03-validkey");
    expect(r).toEqual({ ok: true });
    expect(secretStore.set).toHaveBeenCalledWith("ai.anthropic.key", "sk-ant-api03-validkey");
  });

  it("trims whitespace from key before saving", async () => {
    vi.mocked(secretStore.set).mockImplementation(() => {});
    await call("ai:setKey", "  sk-ant-api03-trimmed  ");
    expect(secretStore.set).toHaveBeenCalledWith("ai.anthropic.key", "sk-ant-api03-trimmed");
  });
});

// ── ai:clearKey ────────────────────────────────────────────────────────────

describe("ai:clearKey", () => {
  it("calls delete and returns true", async () => {
    vi.mocked(secretStore.delete).mockImplementation(() => {});
    expect(await call("ai:clearKey")).toBe(true);
    expect(secretStore.delete).toHaveBeenCalledWith("ai.anthropic.key");
  });
});

// ── ai:getSettings ─────────────────────────────────────────────────────────

describe("ai:getSettings", () => {
  it("returns defaults when no settings row exists", () => {
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue(undefined) });
    const r = call("ai:getSettings") as { enabled: boolean; mode: string };
    expect(r).toEqual({ enabled: false, mode: "off" });
  });

  it("reads ai.enabled and ai.mode from settings_json", () => {
    const json = JSON.stringify({ "ai.enabled": true, "ai.mode": "cloud" });
    mockDb.prepare.mockReturnValue({ get: vi.fn().mockReturnValue({ settings_json: json }) });
    const r = call("ai:getSettings") as { enabled: boolean; mode: string };
    expect(r).toEqual({ enabled: true, mode: "cloud" });
  });
});

// ── ai:setSettings ─────────────────────────────────────────────────────────

describe("ai:setSettings", () => {
  it("rejects non-object payload", async () => {
    const r = await call("ai:setSettings", "bad");
    expect(r).toMatchObject({ ok: false });
  });

  it("updates existing settings_json row", async () => {
    const existing = JSON.stringify({ syncServerUrl: "https://example.com" });
    const mockGet = vi.fn().mockReturnValue({ settings_json: existing });
    const mockRun = vi.fn();
    mockDb.prepare.mockReturnValue({ get: mockGet, run: mockRun });

    const r = await call("ai:setSettings", { enabled: true, mode: "cloud" });
    expect(r).toEqual({ ok: true });
    expect(mockRun).toHaveBeenCalled();
    const written = JSON.parse(mockRun.mock.calls[0]![0] as string) as Record<string, unknown>;
    expect(written["ai.enabled"]).toBe(true);
    expect(written["ai.mode"]).toBe("cloud");
    expect(written["syncServerUrl"]).toBe("https://example.com");
  });
});

// ── ai:testConnection ──────────────────────────────────────────────────────

describe("ai:testConnection", () => {
  it("returns NoKey when no key stored", async () => {
    vi.mocked(secretStore.has).mockReturnValue(false);
    const r = await call("ai:testConnection");
    expect(r).toMatchObject({ ok: false, error: "NoKey" });
  });

  it("returns ok:true when Anthropic API responds 200", async () => {
    vi.mocked(secretStore.has).mockReturnValue(true);
    vi.mocked(secretStore.get).mockReturnValue("sk-ant-api03-test");
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await call("ai:testConnection");
    expect(r).toEqual({ ok: true });
  });

  it("returns InvalidKey on 401 response", async () => {
    vi.mocked(secretStore.has).mockReturnValue(true);
    vi.mocked(secretStore.get).mockReturnValue("sk-ant-api03-bad");
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "" });
    const r = await call("ai:testConnection") as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toBe("InvalidKey");
  });

  it("returns NetworkError on fetch throw", async () => {
    vi.mocked(secretStore.has).mockReturnValue(true);
    vi.mocked(secretStore.get).mockReturnValue("sk-ant-api03-test");
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await call("ai:testConnection") as { ok: boolean; error: string };
    expect(r.ok).toBe(false);
    expect(r.error).toBe("NetworkError");
  });
});
