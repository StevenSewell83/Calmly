import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyUpdateError,
  createUpdateService,
  type AutoUpdaterLike,
  type UpdateService,
} from "../updateService";
import type { UpdateStatus } from "@calmly/shared";

// A minimal fake standing in for electron-updater's `autoUpdater` singleton.
// Real events (checking-for-update / update-available / ...) are plain
// EventEmitter emissions, so the state machine can be driven without
// electron-updater or an Electron runtime.
class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checkForUpdates = vi.fn(async () => null);
  downloadUpdate = vi.fn(async () => []);
  quitAndInstall = vi.fn();
}

function makeService(opts?: {
  isPackaged?: boolean;
  platform?: NodeJS.Platform;
  autoUpdater?: FakeAutoUpdater;
}): { service: UpdateService; autoUpdater: FakeAutoUpdater; log: ReturnType<typeof vi.fn> } {
  const autoUpdater = opts?.autoUpdater ?? new FakeAutoUpdater();
  const log = vi.fn();
  const service = createUpdateService({
    autoUpdater,
    isPackaged: opts?.isPackaged ?? true,
    platform: opts?.platform ?? "linux",
    log,
  });
  return { service, autoUpdater, log };
}

describe("createUpdateService — isPackaged gate", () => {
  it("starts disabled when not packaged, and never touches the autoUpdater", () => {
    const { service, autoUpdater } = makeService({ isPackaged: false });
    expect(service.getStatus().state).toBe("disabled");
    expect(autoUpdater.listenerCount("error")).toBe(0);
  });

  it("starts idle when packaged, and configures autoDownload/autoInstallOnAppQuit", () => {
    const { service, autoUpdater } = makeService({ isPackaged: true });
    expect(service.getStatus().state).toBe("idle");
    expect(autoUpdater.autoDownload).toBe(false);
    expect(autoUpdater.autoInstallOnAppQuit).toBe(true);
  });

  it("start() is a no-op when not packaged — no timers, no check", () => {
    vi.useFakeTimers();
    const { service, autoUpdater } = makeService({ isPackaged: false });
    service.start();
    vi.advanceTimersByTime(7 * 60 * 60_000);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("createUpdateService — event-driven transitions", () => {
  it("checking-for-update -> state checking", () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("checking-for-update");
    expect(service.getStatus().state).toBe("checking");
  });

  it("update-available -> state update-available with version", () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "1.2.3" });
    const status = service.getStatus();
    expect(status.state).toBe("update-available");
    expect(status.version).toBe("1.2.3");
  });

  it("update-not-available -> state idle (checking -> idle, no update)", () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-not-available", { version: "1.0.0" });
    expect(service.getStatus().state).toBe("idle");
  });

  it("download-progress -> state downloading with rounded percent", () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("update-available", { version: "1.2.3" });
    autoUpdater.emit("download-progress", { percent: 42.7 });
    const status = service.getStatus();
    expect(status.state).toBe("downloading");
    expect(status.progressPercent).toBe(43);
  });

  it("update-downloaded -> state ready, progress 100", () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("update-available", { version: "1.2.3" });
    autoUpdater.emit("download-progress", { percent: 55 });
    autoUpdater.emit("update-downloaded", { version: "1.2.3" });
    const status = service.getStatus();
    expect(status.state).toBe("ready");
    expect(status.version).toBe("1.2.3");
    expect(status.progressPercent).toBe(100);
  });
});

describe("createUpdateService — error classification", () => {
  it("classifies an ENOTFOUND message as offline", () => {
    expect(classifyUpdateError(new Error("getaddrinfo ENOTFOUND github.com"), "linux")).toBe("offline");
  });

  it("classifies a 404 as http_4xx", () => {
    expect(classifyUpdateError(new Error("HTTP 404: Not Found"), "linux")).toBe("http_4xx");
  });

  it("classifies a 500 as http_5xx", () => {
    expect(classifyUpdateError(new Error("HTTP 500: Internal Server Error"), "linux")).toBe("http_5xx");
  });

  it("classifies a checksum mismatch as corrupt_download", () => {
    expect(classifyUpdateError(new Error("sha512 checksum mismatch"), "linux")).toBe("corrupt_download");
  });

  it("classifies a missing code signature on darwin as unsigned_mac", () => {
    expect(classifyUpdateError(new Error("Could not get code signature for running application"), "darwin")).toBe(
      "unsigned_mac",
    );
  });

  it("does not classify a signature error as unsigned_mac off darwin", () => {
    expect(classifyUpdateError(new Error("Could not get code signature"), "linux")).not.toBe("unsigned_mac");
  });

  it("falls back to unknown for an unrecognized error", () => {
    expect(classifyUpdateError(new Error("something weird happened"), "linux")).toBe("unknown");
  });

  it("surfaces a real 'error' event through the same classification and never throws", () => {
    const { service, autoUpdater } = makeService({ platform: "win32" });
    autoUpdater.emit("error", new Error("HTTP 503: Service Unavailable"));
    const status = service.getStatus();
    expect(status.state).toBe("error");
    expect(status.errorCode).toBe("http_5xx");
    expect(status.errorMessage).toContain("503");
  });
});

describe("createUpdateService — check()", () => {
  it("is a no-op when not packaged", async () => {
    const { service, autoUpdater } = makeService({ isPackaged: false });
    const status = await service.check();
    expect(status.state).toBe("disabled");
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("sets checking and calls autoUpdater.checkForUpdates()", async () => {
    const { service, autoUpdater } = makeService();
    await service.check();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("lands in error state when checkForUpdates() rejects", async () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const status = await service.check();
    expect(status.state).toBe("error");
    expect(status.errorCode).toBe("offline");
  });

  it("does not start a second check while one is already checking/downloading", async () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.checkForUpdates.mockImplementation(() => new Promise(() => {})); // never resolves
    void service.check();
    expect(service.getStatus().state).toBe("checking");
    await service.check();
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});

describe("createUpdateService — download()", () => {
  it("is a no-op unless state is update-available", async () => {
    const { service, autoUpdater } = makeService();
    const status = await service.download();
    expect(status.state).toBe("idle");
    expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled();
  });

  it("sets downloading and calls autoUpdater.downloadUpdate() from update-available", async () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("update-available", { version: "2.0.0" });
    await service.download();
    expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("lands in error state when downloadUpdate() rejects", async () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("update-available", { version: "2.0.0" });
    autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error("sha512 checksum mismatch"));
    const status = await service.download();
    expect(status.state).toBe("error");
    expect(status.errorCode).toBe("corrupt_download");
  });
});

describe("createUpdateService — quitAndInstall()", () => {
  it("is a no-op unless state is ready", () => {
    const { service, autoUpdater } = makeService();
    service.quitAndInstall();
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("calls autoUpdater.quitAndInstall() from ready", () => {
    const { service, autoUpdater } = makeService();
    autoUpdater.emit("update-available", { version: "2.0.0" });
    autoUpdater.emit("update-downloaded", { version: "2.0.0" });
    service.quitAndInstall();
    expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
  });
});

describe("createUpdateService — subscribe()", () => {
  it("notifies subscribers on every status change", () => {
    const { service, autoUpdater } = makeService();
    const seen: UpdateStatus[] = [];
    service.subscribe((s) => seen.push(s));
    autoUpdater.emit("checking-for-update");
    autoUpdater.emit("update-available", { version: "3.0.0" });
    expect(seen.map((s) => s.state)).toEqual(["checking", "update-available"]);
  });

  it("stops notifying after unsubscribe", () => {
    const { service, autoUpdater } = makeService();
    const handler = vi.fn();
    const unsubscribe = service.subscribe(handler);
    autoUpdater.emit("checking-for-update");
    unsubscribe();
    autoUpdater.emit("update-available", { version: "3.0.0" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not break the service", () => {
    const { service, autoUpdater } = makeService();
    service.subscribe(() => {
      throw new Error("boom");
    });
    expect(() => autoUpdater.emit("checking-for-update")).not.toThrow();
    expect(service.getStatus().state).toBe("checking");
  });
});

describe("createUpdateService — scheduling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks after the initial 30s delay, then every 6h", () => {
    const { service, autoUpdater } = makeService();
    service.start();
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    // Resolve so state returns to idle and a re-check can start.
    autoUpdater.emit("update-not-available", { version: "1.0.0" });

    vi.advanceTimersByTime(6 * 60 * 60_000);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("stop() clears both timers so no further checks fire", () => {
    const { service, autoUpdater } = makeService();
    service.start();
    service.stop();
    vi.advanceTimersByTime(24 * 60 * 60_000);
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("start() is idempotent — calling twice does not double-schedule", () => {
    const { service, autoUpdater } = makeService();
    service.start();
    service.start();
    vi.advanceTimersByTime(30_000);
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
