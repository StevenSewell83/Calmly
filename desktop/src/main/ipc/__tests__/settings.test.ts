import { vi, describe, it, expect, beforeAll } from "vitest";

// Mock electron before imports
vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getVersion: vi.fn(() => "1.2.3") },
}));

vi.mock("../../db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("../../sync/serverConfig", () => ({
  resolveServerUrl: vi.fn(() => "https://sync.example"),
  saveServerUrl: vi.fn(),
  clearServerUrl: vi.fn(),
}));
vi.mock("../../search/backfill", () => ({ reindexSearch: vi.fn() }));

import { ipcMain } from "electron";

type HandleFn = (e: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, HandleFn>();

beforeAll(() => {
  vi.mocked(ipcMain.handle).mockImplementation((ch: string, fn: any) => {
    handlers.set(ch, fn);
    return ipcMain;
  });
  return import("../settings").then(({ registerSettingsIpc }) =>
    registerSettingsIpc(),
  );
});

const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(null, ...args);

describe("settings:getAppVersion", () => {
  it("returns the running app's version from electron's app module", () => {
    expect(call("settings:getAppVersion")).toBe("1.2.3");
  });
});
