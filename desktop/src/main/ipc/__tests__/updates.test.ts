import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@calmly/shared";
import { idleUpdateStatus } from "@calmly/shared";
import type { UpdateService } from "../../updates/updateService";

const hoisted = vi.hoisted(() => {
  return {
    handlers: new Map<string, (e: unknown, ...args: unknown[]) => Promise<unknown> | unknown>(),
    broadcastedEvents: [] as { channel: string; payload: unknown }[],
  };
});

const fakeWindow = {
  isDestroyed: () => false,
  webContents: {
    send: vi.fn((channel: string, payload: unknown) =>
      hoisted.broadcastedEvents.push({ channel, payload }),
    ),
  },
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      cb: (e: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
    ) => hoisted.handlers.set(channel, cb),
  },
  BrowserWindow: {
    getAllWindows: () => [fakeWindow],
  },
}));

import { registerUpdatesIpc, __resetUpdatesIpcForTests } from "../updates";

const handlers = hoisted.handlers;
const broadcastedEvents = hoisted.broadcastedEvents;
const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!(null, ...args);

function makeFakeUpdateService(initial: UpdateStatus): {
  service: UpdateService;
  emit: (status: UpdateStatus) => void;
  check: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
} {
  let status = initial;
  const listeners = new Set<(s: UpdateStatus) => void>();
  const check = vi.fn(async () => status);
  const download = vi.fn(async () => status);
  const quitAndInstall = vi.fn(() => status);
  const service: UpdateService = {
    getStatus: () => status,
    check,
    download,
    quitAndInstall,
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    start: vi.fn(),
    stop: vi.fn(),
  };
  return {
    service,
    emit: (s: UpdateStatus) => {
      status = s;
      for (const l of listeners) l(s);
    },
    check,
    download,
    quitAndInstall,
  };
}

beforeEach(() => {
  handlers.clear();
  broadcastedEvents.length = 0;
  __resetUpdatesIpcForTests();
});

describe("updates:getStatus", () => {
  it("returns the service's current status", async () => {
    const { service } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    expect(await call("updates:getStatus")).toEqual(idleUpdateStatus());
  });
});

describe("updates:check", () => {
  it("delegates to the service and returns its result", async () => {
    const { service, check } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    const result = await call("updates:check");
    expect(check).toHaveBeenCalledTimes(1);
    expect(result).toEqual(idleUpdateStatus());
  });
});

describe("updates:download", () => {
  it("delegates to the service", async () => {
    const { service, download } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    await call("updates:download");
    expect(download).toHaveBeenCalledTimes(1);
  });
});

describe("updates:quitAndInstall", () => {
  it("delegates to the service", async () => {
    const { service, quitAndInstall } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    await call("updates:quitAndInstall");
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe("updates:status-changed push channel", () => {
  it("broadcasts every status change to all BrowserWindows", () => {
    const { service, emit } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    const next: UpdateStatus = {
      state: "update-available",
      version: "1.2.3",
      progressPercent: null,
      errorCode: null,
      errorMessage: null,
    };
    emit(next);
    expect(broadcastedEvents).toEqual([{ channel: "updates:status-changed", payload: next }]);
  });

  it("skips destroyed windows", () => {
    const { service, emit } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    fakeWindow.isDestroyed = () => true;
    emit({ ...idleUpdateStatus(), state: "checking" });
    expect(broadcastedEvents).toEqual([]);
    fakeWindow.isDestroyed = () => false;
  });
});

describe("registerUpdatesIpc registration guard", () => {
  it("only registers handlers once even if called twice", () => {
    const { service } = makeFakeUpdateService(idleUpdateStatus());
    registerUpdatesIpc(service);
    const countAfterFirst = handlers.size;
    registerUpdatesIpc(service);
    expect(handlers.size).toBe(countAfterFirst);
  });
});
