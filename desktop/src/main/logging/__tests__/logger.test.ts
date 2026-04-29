import { describe, expect, it, vi } from "vitest";
import { createDesktopLogger } from "../index";
import type { LogLevel } from "@calmly/shared";

interface CapturedRecord {
  level: LogLevel;
  message: string;
  fields?: Record<string, unknown>;
}

function capture() {
  const records: CapturedRecord[] = [];
  const transport = vi.fn(
    (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
      records.push({ level, message, fields });
    },
  );
  return { records, transport };
}

describe("createDesktopLogger — message scrub", () => {
  it("redacts an Anthropic key in the message string", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.info(
      "talking to anthropic with sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(records[0]?.message).toContain("[REDACTED:api_key_anthropic]");
    expect(records[0]?.message).not.toContain("sk-ant-api03");
  });

  it("redacts an email in the message string", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.warn("user alex@example.com signed out");
    expect(records[0]?.message).toContain("[REDACTED:email]");
    expect(records[0]?.message).not.toContain("alex@example.com");
  });

  it("dispatches each level to the transport", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.trace("a");
    logger.debug("b");
    logger.info("c");
    logger.warn("d");
    logger.error("e");
    logger.fatal("f");
    expect(records.map((r) => r.level)).toEqual([
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal",
    ]);
  });
});

describe("createDesktopLogger — string field scrub", () => {
  it("scrubs string field values but leaves non-strings untouched", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.info("hit", {
      apiKey: "sk-ant-api03-bbbbbbbbbbbbbbbbbbbbbb",
      latency: 42,
      ok: true,
      tagList: ["a", "b"],
    });
    const f = records[0]?.fields ?? {};
    expect(f.apiKey).toBe("[REDACTED:api_key_anthropic]");
    expect(f.latency).toBe(42);
    expect(f.ok).toBe(true);
    // Arrays are non-strings; we don't deep-scrub here, so they pass through
    // untouched. (Defense in depth at this layer covers shape failures, not
    // arbitrary nesting; that's scrubDeep's job and is opt-in.)
    expect(f.tagList).toEqual(["a", "b"]);
  });

  it("undefined fields stay undefined (no empty object materialization)", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.info("hit");
    expect(records[0]?.fields).toBeUndefined();
  });
});

describe("createDesktopLogger — event records", () => {
  it("emits an event record at info level with name + sanitized props", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.event("auth.signed_in", {
      method: "magic-link",
      attempts: 1,
      ok: true,
    });
    expect(records.length).toBe(1);
    expect(records[0]?.level).toBe("info");
    expect(records[0]?.message).toBe("event");
    const f = records[0]?.fields as Record<string, unknown>;
    expect(f.event).toBe("auth.signed_in");
    expect(f.method).toBe("magic-link");
    expect(f.attempts).toBe(1);
    expect(f.ok).toBe(true);
    expect(f.rejected_props).toBeUndefined();
  });

  it("rejects non-allowlisted prop values + surfaces keys in rejected_props", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    logger.event("auth.requested", {
      method: "magic-link",
      // long sentence won't match the enum-string regex
      message: "Hello, world! This is too long to be an enum.",
      // nested object never passes
      meta: { nested: true } as unknown as string,
    });
    const f = records[0]?.fields as Record<string, unknown>;
    expect(f.method).toBe("magic-link");
    expect(f.message).toBeUndefined();
    expect(f.meta).toBeUndefined();
    expect(f.rejected_props).toEqual(
      expect.arrayContaining(["message", "meta"]),
    );
  });

  it("scrubs string values that DID pass the enum-string regex (defense in depth)", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport });
    // The event name itself can't carry an Anthropic key (the validator
    // wouldn't accept one anyway because it has dashes plus a long
    // alphanumeric tail), but a bug-prone caller might pass a token-shaped
    // string as a value. The shape regex permits [A-Za-z0-9_.\-:]{1,64} which
    // CAN match short alphanumeric tokens. The adapter scrubs as a backstop.
    logger.event("payment.charged", {
      // a 36-char base64url-shaped pseudo-key — passes EventValue validation
      // because it's pure alphanumeric and within length, but starts with
      // sk-ant- so scrub catches it.
      key: "sk-ant-api03-cccccccccccccccccccccc",
    });
    const f = records[0]?.fields as Record<string, unknown>;
    expect(f.key).toBe("[REDACTED:api_key_anthropic]");
  });
});

describe("createDesktopLogger — LOG_PII gate", () => {
  it("with allowPii=true, scrub is bypassed for messages and fields", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport, allowPii: true });
    logger.info("user alex@example.com hit /auth", {
      apiKey: "sk-ant-api03-dddddddddddddddddddddd",
    });
    expect(records[0]?.message).toContain("alex@example.com");
    expect(records[0]?.fields?.apiKey).toContain("sk-ant-api03");
  });

  it("with allowPii=true, event values are also passed through", () => {
    const { records, transport } = capture();
    const logger = createDesktopLogger({ transport, allowPii: true });
    logger.event("dev.debug", { trace: "sk-ant-aaaa" });
    const f = records[0]?.fields as Record<string, unknown>;
    expect(f.trace).toBe("sk-ant-aaaa");
  });
});
