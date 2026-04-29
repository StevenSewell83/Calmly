import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashToken,
  isWellFormedToken,
  tokensMatch,
} from "../tokens";

describe("generateToken", () => {
  it("returns a base64url string", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("emits 32 bytes of entropy (43-char base64url)", () => {
    expect(generateToken().length).toBe(43);
  });

  it("returns a different token each call", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  it("is deterministic for the same input", () => {
    const t = "abcdef0123456789";
    expect(hashToken(t)).toBe(hashToken(t));
  });

  it("produces a 64-char hex digest", () => {
    expect(hashToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs across inputs", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("tokensMatch", () => {
  it("matches identical hex strings", () => {
    const h = hashToken("a-token");
    expect(tokensMatch(h, h)).toBe(true);
  });

  it("rejects mismatched hex strings", () => {
    expect(tokensMatch(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("rejects empty strings even when both empty", () => {
    expect(tokensMatch("", "")).toBe(false);
  });

  it("rejects different lengths", () => {
    expect(tokensMatch("abcd", "abcdef")).toBe(false);
  });
});

describe("isWellFormedToken", () => {
  it("accepts a real generated token", () => {
    expect(isWellFormedToken(generateToken())).toBe(true);
  });

  it("rejects non-strings", () => {
    expect(isWellFormedToken(undefined)).toBe(false);
    expect(isWellFormedToken(null)).toBe(false);
    expect(isWellFormedToken(123)).toBe(false);
    expect(isWellFormedToken({})).toBe(false);
  });

  it("rejects too-short and too-long strings", () => {
    expect(isWellFormedToken("abc")).toBe(false);
    expect(isWellFormedToken("a".repeat(200))).toBe(false);
  });

  it("rejects strings with disallowed characters", () => {
    expect(isWellFormedToken("a".repeat(32) + "+")).toBe(false);
    expect(isWellFormedToken("a".repeat(32) + "=")).toBe(false);
    expect(isWellFormedToken("a".repeat(32) + " ")).toBe(false);
  });
});
