import { beforeEach, describe, expect, it, vi } from "vitest";

// POL-03 regression coverage: the crash-reporting toggle must gate the
// *upload* (uploadToServer + submitURL), not just whether crashes are
// collected locally — crashReporter always runs (main/index.ts starts it at
// boot with uploadToServer: false), so "collection" happens either way.

const crashReporterStart = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/fake-crash-dumps"),
  },
  crashReporter: {
    start: crashReporterStart,
  },
}));

let settingsRow: { settings_json: string } | undefined;

const dbStub = {
  prepare: vi.fn((_sql: string) => ({
    get: () => settingsRow,
    run: (json: string) => {
      settingsRow = { settings_json: json };
    },
  })),
};

vi.mock("../../db", () => ({
  getDb: vi.fn(() => dbStub),
}));

describe("crash reporting — opt-in gate", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    settingsRow = undefined;
    delete process.env["CALMLY_CRASH_INGEST_URL"];
  });

  it("does not (re)start crashReporter with uploadToServer:true when disabled by default", async () => {
    const { initCrashReporting } = await import("../index");
    initCrashReporting();
    expect(crashReporterStart).not.toHaveBeenCalled();
  });

  it("starts crashReporter with uploadToServer:true only after the user opts in", async () => {
    const { initCrashReporting, setCrashEnabled } = await import("../index");
    setCrashEnabled(true);
    initCrashReporting();
    expect(crashReporterStart).toHaveBeenCalledWith(
      expect.objectContaining({ uploadToServer: true }),
    );
  });

  it("uses the documented placeholder submitURL when no ingest endpoint is configured", async () => {
    const { initCrashReporting, setCrashEnabled } = await import("../index");
    setCrashEnabled(true);
    initCrashReporting();
    const call = crashReporterStart.mock.calls[0]?.[0] as { submitURL: string };
    expect(call.submitURL).toBe("https://crash-disabled.calmly.invalid/");
  });

  it("uses CALMLY_CRASH_INGEST_URL as the submitURL when configured", async () => {
    process.env["CALMLY_CRASH_INGEST_URL"] = "https://crash.calmly.example/ingest";
    const { initCrashReporting, setCrashEnabled } = await import("../index");
    setCrashEnabled(true);
    initCrashReporting();
    const call = crashReporterStart.mock.calls[0]?.[0] as { submitURL: string };
    expect(call.submitURL).toBe("https://crash.calmly.example/ingest");
  });

  it("getCrashStatus reflects the persisted toggle", async () => {
    const { getCrashStatus, setCrashEnabled } = await import("../index");
    expect((await getCrashStatus()).enabled).toBe(false);
    setCrashEnabled(true);
    expect((await getCrashStatus()).enabled).toBe(true);
  });

  it("flags restartRequired only when the toggle changes since boot", async () => {
    const { initCrashReporting, setCrashEnabled, getCrashStatus } = await import(
      "../index"
    );
    initCrashReporting(); // boots with disabled (default)
    setCrashEnabled(true);
    expect((await getCrashStatus()).restartRequired).toBe(true);
    setCrashEnabled(false);
    expect((await getCrashStatus()).restartRequired).toBe(false);
  });
});
