import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { ConsoleEmailSender } from "../console";

function silentLog(): FastifyBaseLogger {
  const noop = () => {};
  const lg = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    silent: noop,
    level: "silent",
  } as unknown as FastifyBaseLogger & { child: () => FastifyBaseLogger };
  lg.child = () => lg;
  return lg;
}

describe("ConsoleEmailSender", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "calmly-mail-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("writes one HTML file per send", async () => {
    const sender = new ConsoleEmailSender({ log: silentLog(), dir: tmp });
    await sender.sendMagicLink({
      to: "alex@example.com",
      link: "https://example.test/auth?token=abc",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const files = readdirSync(tmp).filter((f) => f.endsWith(".html"));
    expect(files.length).toBe(1);
    const body = readFileSync(join(tmp, files[0]!), "utf-8");
    expect(body).toContain("Calmly");
    expect(body).toContain("https://example.test/auth?token=abc");
  });

  it("produces distinct filenames for distinct links", async () => {
    const sender = new ConsoleEmailSender({ log: silentLog(), dir: tmp });
    const expiresAt = new Date(Date.now() + 60_000);
    await sender.sendMagicLink({
      to: "a@x.test",
      link: "https://example.test/?token=a",
      expiresAt,
    });
    await sender.sendMagicLink({
      to: "b@x.test",
      link: "https://example.test/?token=b",
      expiresAt,
    });
    const files = readdirSync(tmp).filter((f) => f.endsWith(".html"));
    expect(new Set(files).size).toBe(2);
  });
});
