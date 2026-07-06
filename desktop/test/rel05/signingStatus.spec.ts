import { describe, expect, it } from "vitest";
import { describeMacSigning, describeWinSigning } from "../../build/hooks/signingStatus.mjs";

describe("REL-05 signing status (macOS)", () => {
  it("reports unsigned when no secrets are present", () => {
    const status = describeMacSigning({});
    expect(status.willSign).toBe(false);
    expect(status.willNotarize).toBe(false);
    expect(status.message).toMatch(/^UNSIGNED build/);
    expect(status.message).toContain("CSC_LINK");
  });

  it("reports signed-but-not-notarized when only the CSC secrets are present", () => {
    const status = describeMacSigning({ CSC_LINK: "base64", CSC_KEY_PASSWORD: "pw" });
    expect(status.willSign).toBe(true);
    expect(status.willNotarize).toBe(false);
    expect(status.message).toMatch(/NOT NOTARIZED/);
  });

  it("does not report notarization if any one of the three notarize secrets is missing", () => {
    const missingTeamId = describeMacSigning({
      CSC_LINK: "base64",
      CSC_KEY_PASSWORD: "pw",
      APPLE_ID: "dev@calmly.local",
      APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      // APPLE_TEAM_ID intentionally absent
    });
    expect(missingTeamId.willSign).toBe(true);
    expect(missingTeamId.willNotarize).toBe(false);
  });

  it("reports fully signed + notarized when every secret is present", () => {
    const status = describeMacSigning({
      CSC_LINK: "base64",
      CSC_KEY_PASSWORD: "pw",
      APPLE_ID: "dev@calmly.local",
      APPLE_APP_SPECIFIC_PASSWORD: "abcd-efgh-ijkl-mnop",
      APPLE_TEAM_ID: "ABCDE12345",
    });
    expect(status.willSign).toBe(true);
    expect(status.willNotarize).toBe(true);
    expect(status.message).toContain("notarization configured");
  });

  it("never echoes secret values into the message", () => {
    const status = describeMacSigning({
      CSC_LINK: "super-secret-base64-blob",
      CSC_KEY_PASSWORD: "super-secret-password",
      APPLE_ID: "dev@calmly.local",
      APPLE_APP_SPECIFIC_PASSWORD: "super-secret-app-password",
      APPLE_TEAM_ID: "ABCDE12345",
    });
    expect(status.message).not.toContain("super-secret");
  });
});

describe("REL-05 signing status (Windows)", () => {
  it("reports unsigned when no secrets are present", () => {
    const status = describeWinSigning({});
    expect(status.willSign).toBe(false);
    expect(status.message).toMatch(/^UNSIGNED build/);
    expect(status.message).toContain("WIN_CSC_LINK");
  });

  it("signs using WIN_-prefixed vars when present", () => {
    const status = describeWinSigning({ WIN_CSC_LINK: "base64", WIN_CSC_KEY_PASSWORD: "pw" });
    expect(status.willSign).toBe(true);
  });

  it("falls back to the generic CSC_LINK/CSC_KEY_PASSWORD vars", () => {
    const status = describeWinSigning({ CSC_LINK: "base64", CSC_KEY_PASSWORD: "pw" });
    expect(status.willSign).toBe(true);
  });

  it("requires both link and password — link alone is not enough", () => {
    const status = describeWinSigning({ WIN_CSC_LINK: "base64" });
    expect(status.willSign).toBe(false);
  });

  it("never echoes secret values into the message", () => {
    const status = describeWinSigning({ WIN_CSC_LINK: "super-secret-base64-blob", WIN_CSC_KEY_PASSWORD: "super-secret-password" });
    expect(status.message).not.toContain("super-secret");
  });
});
