import { describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { createServerLogger } from "../index";

interface Captured {
  level: string;
  obj: unknown;
  msg?: string;
}

function makeStub(): { logger: FastifyBaseLogger; captured: Captured[] } {
  const captured: Captured[] = [];
  const at =
    (level: string) =>
    (objOrMsg: unknown, msg?: string): void => {
      if (typeof objOrMsg === "string") {
        captured.push({ level, obj: undefined, msg: objOrMsg });
      } else {
        captured.push({ level, obj: objOrMsg, msg });
      }
    };

  const logger = {
    info: at("info"),
    warn: at("warn"),
    error: at("error"),
    debug: at("debug"),
    trace: at("trace"),
    fatal: at("fatal"),
    silent: () => {},
    level: "info",
    child() {
      return logger;
    },
  } as unknown as FastifyBaseLogger;

  return { logger, captured };
}

describe("createServerLogger", () => {
  it("scrubs secrets in messages", () => {
    const { logger, captured } = makeStub();
    const log = createServerLogger(logger);
    log.info("user alex@example.com logged in");
    expect(captured[0]?.msg).toBe("user [REDACTED:email] logged in");
  });

  it("scrubs secrets in string fields", () => {
    const { logger, captured } = makeStub();
    const log = createServerLogger(logger);
    log.warn("auth failed", { token: "Bearer abcdefghijklmnopqrst" });
    const obj = captured[0]?.obj as Record<string, unknown> | undefined;
    expect(obj?.token).toBe("[REDACTED:bearer]");
  });

  it("event() drops invalid props and surfaces rejected keys", () => {
    const { logger, captured } = makeStub();
    const log = createServerLogger(logger);
    log.event("auth.login", {
      ok: true,
      email: "alex@example.com",
      ms: 42,
    });
    const obj = captured[0]?.obj as Record<string, unknown> | undefined;
    expect(obj).toMatchObject({ event: "auth.login", ok: true, ms: 42 });
    expect(obj?.email).toBeUndefined();
    expect(obj?.rejected_props).toEqual(["email"]);
  });

  it("event() never lets a rejected value reach the log", () => {
    const { logger, captured } = makeStub();
    const log = createServerLogger(logger);
    log.event("test", { secret: "sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa" });
    expect(JSON.stringify(captured[0])).not.toContain("sk-ant-api03-");
  });
});
