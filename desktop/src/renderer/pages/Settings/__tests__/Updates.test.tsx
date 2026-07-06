// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import type { UpdateStatus } from "@calmly/shared";
import { SettingsUpdates } from "../Updates";

function status(patch: Partial<UpdateStatus>): UpdateStatus {
  return {
    state: "idle",
    version: null,
    progressPercent: null,
    errorCode: null,
    errorMessage: null,
    ...patch,
  };
}

function mockCalmly(opts: {
  initial: UpdateStatus;
  check?: () => Promise<UpdateStatus>;
  download?: () => Promise<UpdateStatus>;
  quitAndInstall?: () => Promise<UpdateStatus>;
  version?: string;
}) {
  const unsubscribe = vi.fn();
  (window as any).calmly = {
    settings: { getAppVersion: () => Promise.resolve(opts.version ?? "1.4.0") },
    updates: {
      getStatus: () => Promise.resolve(opts.initial),
      check: opts.check ?? (() => Promise.resolve(opts.initial)),
      download: opts.download ?? (() => Promise.resolve(opts.initial)),
      quitAndInstall: opts.quitAndInstall ?? (() => Promise.resolve(opts.initial)),
      onStatusChanged: () => unsubscribe,
    },
  };
  return { unsubscribe };
}

afterEach(() => {
  cleanup();
  delete (window as any).calmly;
});

describe("SettingsUpdates", () => {
  it("shows the current version once resolved", async () => {
    mockCalmly({ initial: status({ state: "idle" }), version: "2.0.1" });
    render(<SettingsUpdates />);
    await waitFor(() => expect(screen.getByText("v2.0.1")).toBeTruthy());
  });

  it("disabled/dev state: shows version and dev copy, not an error", async () => {
    mockCalmly({ initial: status({ state: "disabled" }) });
    render(<SettingsUpdates />);
    await waitFor(() =>
      expect(
        screen.getByText(/Updates are managed by the packaged app/i),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/went wrong/i)).toBeNull();
  });

  it("idle state: shows up to date + check button", async () => {
    mockCalmly({ initial: status({ state: "idle" }) });
    render(<SettingsUpdates />);
    await waitFor(() => expect(screen.getByText("Up to date.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeTruthy();
  });

  it("checking state: shows a checking indicator", async () => {
    mockCalmly({ initial: status({ state: "checking" }) });
    render(<SettingsUpdates />);
    await waitFor(() => expect(screen.getByText(/Checking for updates/)).toBeTruthy());
  });

  it("update-available state: shows version + download button", async () => {
    mockCalmly({ initial: status({ state: "update-available", version: "2.1.0" }) });
    render(<SettingsUpdates />);
    await waitFor(() => expect(screen.getByText(/Version 2\.1\.0 available/)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("downloading state: shows a progress bar with percent", async () => {
    mockCalmly({
      initial: status({ state: "downloading", version: "2.1.0", progressPercent: 42 }),
    });
    render(<SettingsUpdates />);
    await waitFor(() => {
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuenow")).toBe("42");
    });
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("ready state: shows restart-to-update button", async () => {
    mockCalmly({ initial: status({ state: "ready", version: "2.1.0" }) });
    render(<SettingsUpdates />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restart to update" })).toBeTruthy(),
    );
    expect(screen.getByText(/ready — restart to finish installing/)).toBeTruthy();
  });

  it("error state: shows human copy and a retry button that re-checks", async () => {
    const check = vi.fn(() => Promise.resolve(status({ state: "idle" })));
    mockCalmly({
      initial: status({ state: "error", errorCode: "offline", errorMessage: "ENOTFOUND" }),
      check,
    });
    render(<SettingsUpdates />);
    await waitFor(() =>
      expect(screen.getByText(/Couldn't reach the update server/)).toBeTruthy(),
    );
    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it("check button calls updates.check()", async () => {
    const check = vi.fn(() => Promise.resolve(status({ state: "checking" })));
    mockCalmly({ initial: status({ state: "idle" }), check });
    render(<SettingsUpdates />);
    const btn = await screen.findByRole("button", { name: "Check for updates" });
    fireEvent.click(btn);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it("download button calls updates.download()", async () => {
    const download = vi.fn(() => Promise.resolve(status({ state: "downloading" })));
    mockCalmly({
      initial: status({ state: "update-available", version: "9.9.9" }),
      download,
    });
    render(<SettingsUpdates />);
    const btn = await screen.findByRole("button", { name: "Download" });
    fireEvent.click(btn);
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
  });

  it("restart button calls updates.quitAndInstall()", async () => {
    const quitAndInstall = vi.fn(() => Promise.resolve(status({ state: "ready" })));
    mockCalmly({ initial: status({ state: "ready", version: "9.9.9" }), quitAndInstall });
    render(<SettingsUpdates />);
    const btn = await screen.findByRole("button", { name: "Restart to update" });
    fireEvent.click(btn);
    await waitFor(() => expect(quitAndInstall).toHaveBeenCalledTimes(1));
  });
});
