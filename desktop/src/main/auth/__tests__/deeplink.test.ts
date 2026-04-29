import { describe, expect, it } from "vitest";
import { findDeepLinkInArgv, parseDeepLink } from "../deeplink";

describe("parseDeepLink", () => {
  it("extracts the token from a well-formed URL", () => {
    const r = parseDeepLink("calmly://auth/callback?token=abc123");
    expect(r).toEqual({ token: "abc123" });
  });

  it("preserves URL-encoded token values", () => {
    const r = parseDeepLink(
      "calmly://auth/callback?token=ab%2Bcd%2F%3D%3D",
    );
    // URL.searchParams.get decodes percent-encoding for us.
    expect(r).toEqual({ token: "ab+cd/==" });
  });

  it("treats the scheme case-insensitively", () => {
    expect(
      parseDeepLink("CALMLY://auth/callback?token=abc"),
    ).toEqual({ token: "abc" });
  });

  it("rejects unknown protocols", () => {
    expect(parseDeepLink("https://example.com/auth/callback?token=abc")).toBe(
      null,
    );
    expect(parseDeepLink("evil://auth/callback?token=abc")).toBe(null);
  });

  it("rejects right scheme but wrong host", () => {
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
    expect(r).toEqual({ token: "abc" });
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
});
