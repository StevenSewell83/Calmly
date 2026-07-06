import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { AuthOrchestrator, RedeemResult } from "../../auth/session";

// createDeepLinkBootstrap wires installDeepLink (which touches the real
// Electron `app`) at module scope, so stand in for it with a fake that just
// hands back the `onUrl` callback the bootstrap registered. That callback is
// exactly what installDeepLink invokes for both macOS "open-url" and
// Windows/Linux "second-instance" — from this module's point of view the
// two platforms are indistinguishable, which is the point: the buffering
// logic below is the shared layer both funnel through.
let capturedOnUrl: ((url: string) => void) | null = null;
const unregister = vi.fn();

vi.mock("../../auth/deeplink-install", () => ({
  installDeepLink: vi.fn((args: { onUrl: (url: string) => void }) => {
    capturedOnUrl = args.onUrl;
    return { unregister };
  }),
}));

import { createDeepLinkBootstrap } from "../deeplinks";

function fakeOrchestrator(
  redeem: (token: string) => Promise<RedeemResult> = async () => ({
    ok: true,
    user: { id: "u1", email: "alex@example.com" },
    expiresAt: "2026-01-01T00:00:00Z",
  }),
): AuthOrchestrator {
  return {
    requestLink: vi.fn(),
    redeem: vi.fn(redeem),
    status: vi.fn(),
    signOut: vi.fn(),
  };
}

function fakeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: { send: vi.fn() },
  };
}

beforeEach(() => {
  capturedOnUrl = null;
  unregister.mockClear();
});

describe("createDeepLinkBootstrap — buffering (open-url before a window exists)", () => {
  it("holds a URL that arrives before setReady, then delivers it once ready", async () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();
    expect(capturedOnUrl).toBeTypeOf("function");

    const orch = fakeOrchestrator();
    // Simulate the macOS open-url event firing before the main window/
    // orchestrator exist (cold start).
    capturedOnUrl!("calmly://auth/callback?token=abc123");
    expect(orch.redeem).not.toHaveBeenCalled();

    const win = fakeWindow();
    bootstrap.setReady(orch, () => win as unknown as BrowserWindow);

    expect(orch.redeem).toHaveBeenCalledOnce();
    expect(orch.redeem).toHaveBeenCalledWith("abc123");
    await vi.waitFor(() => {
      expect(win.webContents.send).toHaveBeenCalledOnce();
    });
    expect(win.webContents.send).toHaveBeenCalledWith(
      "auth:deeplink-redeemed",
      { ok: true, user: { id: "u1", email: "alex@example.com" }, expiresAt: "2026-01-01T00:00:00Z" },
    );
  });

  it("delivers multiple buffered URLs in arrival order", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    capturedOnUrl!("calmly://auth/callback?token=first");
    capturedOnUrl!("calmly://auth/callback?token=second");

    const orch = fakeOrchestrator();
    const redeemedTokens: string[] = [];
    (orch.redeem as ReturnType<typeof vi.fn>).mockImplementation(
      async (token: string) => {
        redeemedTokens.push(token);
        return { ok: true, user: { id: "u1", email: "a@b.com" }, expiresAt: "x" };
      },
    );
    const win = fakeWindow();
    bootstrap.setReady(orch, () => win as unknown as BrowserWindow);

    expect(redeemedTokens).toEqual(["first", "second"]);
  });

  it("dispatches a URL immediately (no buffering) when it arrives after setReady", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    const orch = fakeOrchestrator();
    const win = fakeWindow();
    bootstrap.setReady(orch, () => win as unknown as BrowserWindow);

    capturedOnUrl!("calmly://auth/callback?token=live");

    expect(orch.redeem).toHaveBeenCalledOnce();
    expect(orch.redeem).toHaveBeenCalledWith("live");
  });

  it("silently drops a malformed/unrecognized deep link instead of throwing", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    expect(() => capturedOnUrl!("not-a-calmly-url")).not.toThrow();

    const orch = fakeOrchestrator();
    const win = fakeWindow();
    expect(() =>
      bootstrap.setReady(orch, () => win as unknown as BrowserWindow),
    ).not.toThrow();
    expect(orch.redeem).not.toHaveBeenCalled();
  });

  it("does not send the redeem result to a window that has since been destroyed", async () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    const orch = fakeOrchestrator();
    const win = fakeWindow();
    win.isDestroyed.mockReturnValue(true);
    bootstrap.setReady(orch, () => win as unknown as BrowserWindow);

    capturedOnUrl!("calmly://auth/callback?token=abc");
    await vi.waitFor(() => {
      expect(orch.redeem).toHaveBeenCalled();
    });
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});

describe("createDeepLinkBootstrap — pushFromArgv (cold-start Windows/Linux path)", () => {
  it("buffers an argv-extracted URL the same way as an open-url event", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    bootstrap.pushFromArgv([
      "/usr/bin/calmly",
      "calmly://auth/callback?token=fromargv",
    ]);

    const orch = fakeOrchestrator();
    const win = fakeWindow();
    bootstrap.setReady(orch, () => win as unknown as BrowserWindow);

    expect(orch.redeem).toHaveBeenCalledOnce();
    expect(orch.redeem).toHaveBeenCalledWith("fromargv");
  });

  it("is a no-op when argv has no calmly:// entry", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    bootstrap.pushFromArgv(["/usr/bin/calmly", "--dev"]);

    const orch = fakeOrchestrator();
    const win = fakeWindow();
    bootstrap.setReady(orch, () => win as unknown as BrowserWindow);

    expect(orch.redeem).not.toHaveBeenCalled();
  });
});

describe("createDeepLinkBootstrap — calendar OAuth deep links", () => {
  it("notifies subscribers once ready, without needing a window", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    const handler = vi.fn();
    bootstrap.onCalendarOAuth(handler);

    capturedOnUrl!("calmly://oauth/google/done?ticket=t1");

    const orch = fakeOrchestrator();
    bootstrap.setReady(orch, () => null);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({
      provider: "google",
      ticket: "t1",
    });
  });

  it("unsubscribing stops further notifications", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    const handler = vi.fn();
    const unsubscribe = bootstrap.onCalendarOAuth(handler);
    unsubscribe();

    const orch = fakeOrchestrator();
    bootstrap.setReady(orch, () => null);
    capturedOnUrl!("calmly://oauth/google/done?ticket=t2");

    expect(handler).not.toHaveBeenCalled();
  });

  it("a throwing subscriber does not stop the flow or other subscribers", () => {
    const bootstrap = createDeepLinkBootstrap();
    bootstrap.install();

    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    bootstrap.onCalendarOAuth(bad);
    bootstrap.onCalendarOAuth(good);

    const orch = fakeOrchestrator();
    bootstrap.setReady(orch, () => null);

    expect(() =>
      capturedOnUrl!("calmly://oauth/microsoft/done?ticket=t3"),
    ).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
    expect(good).toHaveBeenCalledWith({
      provider: "microsoft",
      ticket: "t3",
    });
  });
});
