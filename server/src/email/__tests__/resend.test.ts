import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { ResendEmailError, ResendEmailSender } from "../resend";

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

function fakeOk(): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ id: "res_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("ResendEmailSender", () => {
  it("posts to api.resend.com with bearer auth + JSON body", async () => {
    const fetchMock = fakeOk();
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "Calmly <hello@calmly.test>",
      log: silentLog(),
      fetchImpl: fetchMock,
    });
    await sender.sendMagicLink({
      to: "alex@example.com",
      link: "https://example.test/auth?token=abc",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe("Calmly <hello@calmly.test>");
    expect(body.to).toEqual(["alex@example.com"]);
    expect(typeof body.subject).toBe("string");
    expect(typeof body.html).toBe("string");
    expect(typeof body.text).toBe("string");
    expect(body.text).toContain("https://example.test/auth?token=abc");
  });

  it("throws ResendEmailError with status + body on non-2xx", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ name: "validation_error", message: "bad email" }),
          { status: 422 },
        ),
    ) as unknown as typeof fetch;
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "Calmly <hello@calmly.test>",
      log: silentLog(),
      fetchImpl: fetchMock,
    });

    await expect(
      sender.sendMagicLink({
        to: "alex@example.com",
        link: "https://x.test",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    ).rejects.toBeInstanceOf(ResendEmailError);
  });
});
