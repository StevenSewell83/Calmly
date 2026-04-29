import { describe, expect, it } from "vitest";
import {
  buildEventRecord,
  isValidEventValue,
  sanitizeEventProps,
} from "../logger";

describe("isValidEventValue", () => {
  it("accepts booleans", () => {
    expect(isValidEventValue(true)).toBe(true);
    expect(isValidEventValue(false)).toBe(true);
  });

  it("accepts finite numbers", () => {
    expect(isValidEventValue(0)).toBe(true);
    expect(isValidEventValue(42)).toBe(true);
    expect(isValidEventValue(-3.14)).toBe(true);
  });

  it("rejects non-finite numbers", () => {
    expect(isValidEventValue(NaN)).toBe(false);
    expect(isValidEventValue(Infinity)).toBe(false);
  });

  it("accepts short enum-like strings", () => {
    expect(isValidEventValue("ok")).toBe(true);
    expect(isValidEventValue("login.success")).toBe(true);
    expect(isValidEventValue("user-1")).toBe(true);
  });

  it("rejects strings that look like content", () => {
    expect(isValidEventValue("Hello world")).toBe(false);
    expect(isValidEventValue("alex@example.com")).toBe(false);
    expect(isValidEventValue("a sentence with spaces and punctuation!")).toBe(
      false,
    );
  });

  it("rejects empty and oversized strings", () => {
    expect(isValidEventValue("")).toBe(false);
    expect(isValidEventValue("a".repeat(65))).toBe(false);
  });

  it("rejects non-primitive values", () => {
    expect(isValidEventValue({})).toBe(false);
    expect(isValidEventValue([])).toBe(false);
    expect(isValidEventValue(null)).toBe(false);
    expect(isValidEventValue(undefined)).toBe(false);
  });
});

describe("sanitizeEventProps", () => {
  it("keeps allowed values, drops rejected", () => {
    const r = sanitizeEventProps({
      ok: true,
      count: 5,
      tag: "login.success",
      message: "User signed in successfully",
      email: "alex@example.com",
    });
    expect(r.sanitized).toEqual({
      ok: true,
      count: 5,
      tag: "login.success",
    });
    expect(r.rejected.sort()).toEqual(["email", "message"]);
  });

  it("returns empty when given undefined", () => {
    expect(sanitizeEventProps(undefined)).toEqual({
      sanitized: {},
      rejected: [],
    });
  });
});

describe("buildEventRecord", () => {
  it("includes the event name and sanitized props", () => {
    const r = buildEventRecord("auth.login", { ok: true, ms: 42 });
    expect(r.event).toBe("auth.login");
    expect(r.ok).toBe(true);
    expect(r.ms).toBe(42);
    expect(r.rejected_props).toBeUndefined();
  });

  it("surfaces rejected keys when sanitization drops content", () => {
    const r = buildEventRecord("auth.login", {
      ok: true,
      email: "alex@example.com",
    });
    expect(r.ok).toBe(true);
    expect(r.email).toBeUndefined();
    expect(r.rejected_props).toEqual(["email"]);
  });

  it("rejects values that look like content (spaces, punctuation)", () => {
    const r = buildEventRecord("test", {
      sentence: "hello world this has spaces",
      json_blob: "{\"a\": 1}",
    });
    expect(r.sentence).toBeUndefined();
    expect(r.json_blob).toBeUndefined();
    expect(r.rejected_props?.sort()).toEqual(["json_blob", "sentence"]);
  });

  // Note: a string of allowed characters that happens to be a secret WILL pass
  // shape validation here. Content-level redaction is the adapter's job
  // (see createServerLogger / createDesktopLogger which run scrub() on top).
});
