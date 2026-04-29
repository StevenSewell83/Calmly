import { describe, expect, it } from "vitest";
import { scrub, scrubDeep } from "../scrub";

describe("scrub", () => {
  it("redacts an Anthropic key", () => {
    const out = scrub("auth: sk-ant-api03-abcdefghijklmnop1234567890");
    expect(out).toContain("[REDACTED:api_key_anthropic]");
    expect(out).not.toContain("sk-ant-api03-");
  });

  it("redacts an OpenAI key", () => {
    const out = scrub("token=sk-abcdefghijklmnopqrstuvwxyzABCD");
    expect(out).toContain("[REDACTED:api_key_openai]");
  });

  it("does not match the OpenAI prefix on Anthropic keys (order matters)", () => {
    const out = scrub("sk-ant-api03-abcdefghijklmnop1234567890");
    expect(out).toBe("[REDACTED:api_key_anthropic]");
  });

  it("redacts an AWS access key", () => {
    expect(scrub("AKIAABCDEFGHIJKLMNOP")).toBe("[REDACTED:api_key_aws]");
  });

  it("redacts a GitHub PAT", () => {
    const out = scrub("ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL");
    expect(out).toBe("[REDACTED:api_key_github]");
  });

  it("redacts a JWT-shaped string", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fwpMeJf";
    expect(scrub(jwt)).toBe("[REDACTED:jwt]");
  });

  it("redacts a Bearer header value", () => {
    expect(scrub("authorization: Bearer abcdefghijklmnopqrst")).toContain(
      "[REDACTED:bearer]",
    );
  });

  it("redacts an email", () => {
    expect(scrub("user alex@example.com signed in")).toBe(
      "user [REDACTED:email] signed in",
    );
  });

  it("does NOT redact 'user_id' (false-positive guard)", () => {
    expect(scrub("user_id=abc-123")).toBe("user_id=abc-123");
  });

  it("does NOT redact a UUID", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(scrub(`session=${uuid}`)).toBe(`session=${uuid}`);
  });

  it("preserves non-secret content", () => {
    expect(scrub("loaded 42 tasks for active user")).toBe(
      "loaded 42 tasks for active user",
    );
  });

  it("redacts multiple secrets in one string", () => {
    const out = scrub("AKIAABCDEFGHIJKLMNOP and email a@b.com");
    expect(out).toContain("[REDACTED:api_key_aws]");
    expect(out).toContain("[REDACTED:email]");
  });
});

describe("scrubDeep", () => {
  it("scrubs string leaves in nested objects", () => {
    const r = scrubDeep({
      user: { email: "alex@example.com", id: "u-1" },
      authorization: "Bearer abcdefghijklmnopqrst",
    });
    expect(JSON.stringify(r)).toContain("[REDACTED:email]");
    expect(JSON.stringify(r)).toContain("[REDACTED:bearer]");
    expect(JSON.stringify(r)).toContain("u-1");
  });

  it("preserves numbers and booleans untouched", () => {
    const r = scrubDeep({ count: 42, ok: true });
    expect(r).toEqual({ count: 42, ok: true });
  });

  it("converts Buffer-like values to [BINARY]", () => {
    const r = scrubDeep({ data: Buffer.from("secret") });
    expect((r as { data: string }).data).toBe("[BINARY]");
  });

  it("truncates beyond max depth", () => {
    const r = scrubDeep({ a: { b: { c: { d: { e: "x" } } } } }, 2);
    expect(JSON.stringify(r)).toContain("[TRUNCATED]");
  });
});
