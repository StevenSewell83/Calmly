import { describe, expect, it } from "vitest";
import { findDeepLinkInArgv, parseDeepLink } from "../deeplink";

describe("parseDeepLink — auth callback", () => {
  it("extracts the token from a well-formed URL", () => {
    const r = parseDeepLink("calmly://auth/callback?token=abc123");
    expect(r).toEqual({ kind: "auth", token: "abc123" });
  });

  it("preserves URL-encoded token values", () => {
    const r = parseDeepLink("calmly://auth/callback?token=ab%2Bcd%2F%3D%3D");
    expect(r).toEqual({ kind: "auth", token: "ab+cd/==" });
  });

  it("treats the scheme case-insensitively", () => {
    expect(parseDeepLink("CALMLY://auth/callback?token=abc")).toEqual({
      kind: "auth",
      token: "abc",
    });
  });

  it("rejects unknown protocols", () => {
    expect(parseDeepLink("https://example.com/auth/callback?token=abc")).toBe(
      null,
    );
    expect(parseDeepLink("evil://auth/callback?token=abc")).toBe(null);
  });

  it("rejects right scheme but unknown host", () => {
    expect(parseDeepLink("calmly://other/callback?token=abc")).toBe(null);
  });

  it("rejects right scheme but wrong path", () => {
    expect(parseDeepLink("calmly://auth/redeem?token=abc")).toBe(null);
    expect(parseDeepLink("calmly://auth/?token=abc")).toBe(null);
  });

  it("rejects URL with no token query param", () => {
    expect(parseDeepLink("calmly://auth/callback")).toBe(null);
    expect(parseDeepLink("calmly://auth/callback?other=x")).toBe(null);
  });

  it("rejects empty token", () => {
    expect(parseDeepLink("calmly://auth/callback?token=")).toBe(null);
  });

  it("rejects non-strings and unparseable URLs", () => {
    expect(parseDeepLink(null)).toBe(null);
    expect(parseDeepLink(undefined)).toBe(null);
    expect(parseDeepLink(42)).toBe(null);
    expect(parseDeepLink("not a url")).toBe(null);
  });

  it("tolerates an optional trailing slash on /callback", () => {
    const r = parseDeepLink("calmly://auth/callback/?token=abc");
    expect(r).toEqual({ kind: "auth", token: "abc" });
  });
});

describe("parseDeepLink — calendar OAuth done", () => {
  it("extracts the ticket for google", () => {
    const r = parseDeepLink("calmly://oauth/google/done?ticket=abc.def");
    expect(r).toEqual({
      kind: "calendar-oauth",
      provider: "google",
      ticket: "abc.def",
    });
  });

  it("extracts the ticket for microsoft", () => {
    const r = parseDeepLink("calmly://oauth/microsoft/done?ticket=xyz");
    expect(r).toEqual({
      kind: "calendar-oauth",
      provider: "microsoft",
      ticket: "xyz",
    });
  });

  it("rejects an unknown provider", () => {
    expect(parseDeepLink("calmly://oauth/apple/done?ticket=abc")).toBe(null);
  });

  it("rejects a missing ticket", () => {
    expect(parseDeepLink("calmly://oauth/google/done")).toBe(null);
    expect(parseDeepLink("calmly://oauth/google/done?other=x")).toBe(null);
  });

  it("rejects empty ticket", () => {
    expect(parseDeepLink("calmly://oauth/google/done?ticket=")).toBe(null);
  });

  it("rejects an unknown action segment", () => {
    expect(parseDeepLink("calmly://oauth/google/start?ticket=abc")).toBe(null);
  });

  it("rejects an extra path segment", () => {
    expect(parseDeepLink("calmly://oauth/google/done/extra?ticket=abc")).toBe(
      null,
    );
  });

  it("tolerates a trailing slash on the action", () => {
    const r = parseDeepLink("calmly://oauth/google/done/?ticket=abc");
    expect(r).toEqual({
      kind: "calendar-oauth",
      provider: "google",
      ticket: "abc",
    });
  });
});

describe("findDeepLinkInArgv", () => {
  it("finds calmly:// among other args", () => {
    const argv = [
      "C:\\Users\\x\\Calmly.exe",
      "--some-flag",
      "calmly://auth/callback?token=abc",
    ];
    expect(findDeepLinkInArgv(argv)).toBe("calmly://auth/callback?token=abc");
  });

  it("returns null when no calmly:// arg present", () => {
    expect(findDeepLinkInArgv(["/usr/bin/calmly", "--dev"])).toBe(null);
  });

  it("treats scheme case-insensitively", () => {
    expect(
      findDeepLinkInArgv(["/usr/bin/calmly", "Calmly://auth/callback?token=x"]),
    ).toBe("Calmly://auth/callback?token=x");
  });

  it("returns the first match if multiple present", () => {
    const argv = [
      "calmly",
      "calmly://auth/callback?token=first",
      "calmly://auth/callback?token=second",
    ];
    expect(findDeepLinkInArgv(argv)).toContain("first");
  });

  it("ignores non-string entries gracefully", () => {
    const argv = [42 as unknown as string, "calmly://auth/callback?token=x"];
    expect(findDeepLinkInArgv(argv)).toBe("calmly://auth/callback?token=x");
  });

  // REL-03: on Windows, packaged protocol launches deliver the calmly:// URL
  // as an argv entry in two distinct shapes — cold start (process.argv of a
  // fresh launch triggered by the OS) and second-instance (the argv Electron
  // hands to the existing instance's "second-instance" listener when a
  // protocol click re-invokes an already-running app). Both are plain
  // string[] by the time they reach findDeepLinkInArgv, so one parser
  // covers both — these cases pin the exact shapes each path produces.
  it("cold start: extracts the URL from a fresh-launch argv (exe path + flags + URL)", () => {
    const coldStartArgv = [
      "C:\\Users\\alex\\AppData\\Local\\Programs\\Calmly\\Calmly.exe",
      "calmly://auth/callback?token=coldstart",
    ];
    expect(findDeepLinkInArgv(coldStartArgv)).toBe(
      "calmly://auth/callback?token=coldstart",
    );
  });

  it("cold start: returns null when launched with no protocol URL (normal double-click)", () => {
    const coldStartArgv = [
      "C:\\Users\\alex\\AppData\\Local\\Programs\\Calmly\\Calmly.exe",
    ];
    expect(findDeepLinkInArgv(coldStartArgv)).toBe(null);
  });

  it("second-instance: extracts the URL from the argv passed to the running instance", () => {
    // Shape Electron's `second-instance` event delivers: the relaunching
    // process's full argv, exe path first, our custom NSIS-appended URL last.
    const secondInstanceArgv = [
      "C:\\Users\\alex\\AppData\\Local\\Programs\\Calmly\\Calmly.exe",
      "--allow-file-access-from-files",
      "calmly://auth/callback?token=secondinstance",
    ];
    expect(findDeepLinkInArgv(secondInstanceArgv)).toBe(
      "calmly://auth/callback?token=secondinstance",
    );
  });

  it("second-instance: first URL wins if the OS/shell somehow passes more than one", () => {
    const secondInstanceArgv = [
      "Calmly.exe",
      "calmly://auth/callback?token=first",
      "calmly://auth/callback?token=second",
    ];
    expect(findDeepLinkInArgv(secondInstanceArgv)).toBe(
      "calmly://auth/callback?token=first",
    );
  });
});
