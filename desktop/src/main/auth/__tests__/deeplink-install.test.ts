import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// installDeepLink/acquireSingleInstanceLock import the real `app` singleton
// from electron, which isn't available in this container. Stand in with a
// minimal fake that behaves like the real thing for the handful of APIs
// these two functions touch: EventEmitter for on/off/emit (so we can fire
// "open-url"/"second-instance" exactly like Electron does), plus
// setAsDefaultProtocolClient/requestSingleInstanceLock as spies.
//
// This is the mac-specific risk this bead calls out: on macOS, protocol
// launches arrive exclusively via the "open-url" event (never argv/
// second-instance like Windows/Linux), so installDeepLink must register an
// "open-url" listener — these tests pin that down independently of platform.
class FakeApp extends EventEmitter {
  setAsDefaultProtocolClient = vi.fn();
  requestSingleInstanceLock = vi.fn(() => true);
}

let fakeApp: FakeApp;

vi.mock("electron", () => ({
  get app() {
    return fakeApp;
  },
}));

import { installDeepLink, acquireSingleInstanceLock } from "../deeplink-install";
import { PROTOCOL } from "../deeplink";

beforeEach(() => {
  fakeApp = new FakeApp();
});

describe("installDeepLink", () => {
  it("registers calmly:// as the default protocol client", () => {
    installDeepLink({ onUrl: vi.fn() });
    expect(fakeApp.setAsDefaultProtocolClient).toHaveBeenCalledWith(PROTOCOL);
  });

  it("routes a macOS open-url event into onUrl and prevents the default", () => {
    const onUrl = vi.fn();
    installDeepLink({ onUrl });

    const event = { preventDefault: vi.fn() };
    fakeApp.emit("open-url", event, "calmly://auth/callback?token=abc");

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onUrl).toHaveBeenCalledOnce();
    expect(onUrl).toHaveBeenCalledWith("calmly://auth/callback?token=abc");
  });

  it("delivers every open-url emission in order, even multiple before a window exists", () => {
    const seen: string[] = [];
    installDeepLink({ onUrl: (url) => seen.push(url) });

    const event = { preventDefault: vi.fn() };
    fakeApp.emit("open-url", event, "calmly://auth/callback?token=first");
    fakeApp.emit("open-url", event, "calmly://auth/callback?token=second");

    expect(seen).toEqual([
      "calmly://auth/callback?token=first",
      "calmly://auth/callback?token=second",
    ]);
  });

  it("extracts and routes a calmly:// URL out of a second-instance argv", () => {
    const onUrl = vi.fn();
    installDeepLink({ onUrl });

    fakeApp.emit("second-instance", {}, [
      "/usr/bin/calmly",
      "--allow-file-access-from-files",
      "calmly://auth/callback?token=xyz",
    ]);

    expect(onUrl).toHaveBeenCalledOnce();
    expect(onUrl).toHaveBeenCalledWith("calmly://auth/callback?token=xyz");
  });

  it("ignores a second-instance argv with no deep link present", () => {
    const onUrl = vi.fn();
    installDeepLink({ onUrl });

    fakeApp.emit("second-instance", {}, ["/usr/bin/calmly", "--dev"]);

    expect(onUrl).not.toHaveBeenCalled();
  });

  it("unregister() detaches both listeners so later events are ignored", () => {
    const onUrl = vi.fn();
    const handle = installDeepLink({ onUrl });

    handle.unregister();

    fakeApp.emit(
      "open-url",
      { preventDefault: vi.fn() },
      "calmly://auth/callback?token=late",
    );
    fakeApp.emit("second-instance", {}, ["calmly://auth/callback?token=late"]);

    expect(onUrl).not.toHaveBeenCalled();
  });
});

describe("acquireSingleInstanceLock", () => {
  it("delegates to app.requestSingleInstanceLock", () => {
    fakeApp.requestSingleInstanceLock.mockReturnValue(true);
    expect(acquireSingleInstanceLock()).toBe(true);

    fakeApp.requestSingleInstanceLock.mockReturnValue(false);
    expect(acquireSingleInstanceLock()).toBe(false);
  });
});
