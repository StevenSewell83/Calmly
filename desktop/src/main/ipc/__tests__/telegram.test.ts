import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  return {
    handlers: new Map<
      string,
      (e: unknown, ...args: unknown[]) => Promise<unknown>
    >(),
    state: { signedIn: true },
    mockUser: { id: "user-1", email: "alex@example.com" },
  };
});

vi.mock("electron", () => ({
  ipcMain: {
    handle: (
      channel: string,
      cb: (e: unknown, ...args: unknown[]) => Promise<unknown>,
    ) => hoisted.handlers.set(channel, cb),
  },
}));

vi.mock("../../auth/currentUser", () => ({
  getCurrentUser: () => (hoisted.state.signedIn ? hoisted.mockUser : null),
}));

const handlers = hoisted.handlers;

import { __resetTelegramIpcForTests, registerTelegramIpc } from "../telegram";
import type { ApiClient } from "../../net/client";
import { ApiHttpError, ApiNetworkError } from "../../net/client";

function call(channel: string, ...args: unknown[]): Promise<unknown> {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
}

beforeEach(() => {
  hoisted.state.signedIn = true;
  handlers.clear();
  __resetTelegramIpcForTests();
});

function setup(request: ApiClient["request"]): void {
  registerTelegramIpc({ apiClient: { request } });
}

describe("telegram:getStatus", () => {
  it("returns NotSignedIn when no current user", async () => {
    hoisted.state.signedIn = false;
    setup(vi.fn() as unknown as ApiClient["request"]);
    expect(await call("telegram:getStatus")).toEqual({
      ok: false,
      error: "NotSignedIn",
    });
  });

  it("returns unlinked status", async () => {
    setup(
      vi.fn(async () => ({ status: 200, body: { linked: false } })) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:getStatus")).toEqual({ ok: true, linked: false });
  });

  it("returns linked status with chatId + linkedAt", async () => {
    setup(
      vi.fn(async () => ({
        status: 200,
        body: { linked: true, chatId: "12345", linkedAt: 1700000000000 },
      })) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:getStatus")).toEqual({
      ok: true,
      linked: true,
      chatId: "12345",
      linkedAt: 1700000000000,
    });
  });

  it("maps a 401 to NotSignedIn", async () => {
    setup(
      vi.fn(async () => {
        throw new ApiHttpError("unauthorized", 401, null);
      }) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:getStatus")).toEqual({
      ok: false,
      error: "NotSignedIn",
    });
  });

  it("maps a network error to NetworkError", async () => {
    setup(
      vi.fn(async () => {
        throw new ApiNetworkError("offline");
      }) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:getStatus")).toEqual({
      ok: false,
      error: "NetworkError",
    });
  });

  it("maps any other server error to InternalError", async () => {
    setup(
      vi.fn(async () => {
        throw new ApiHttpError("server fail", 500, null);
      }) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:getStatus")).toEqual({
      ok: false,
      error: "InternalError",
    });
  });
});

describe("telegram:createLinkingCode", () => {
  it("returns NotSignedIn when no current user", async () => {
    hoisted.state.signedIn = false;
    setup(vi.fn() as unknown as ApiClient["request"]);
    expect(await call("telegram:createLinkingCode")).toEqual({
      ok: false,
      error: "NotSignedIn",
    });
  });

  it("happy path: combines /linking/code with /telegram/health's botUsername", async () => {
    const request = vi.fn(async (_m: string, path: string) => {
      if (path === "/telegram/linking/code") {
        return { status: 200, body: { code: "ABCD1234", expiresAt: 1700000900000 } };
      }
      if (path === "/telegram/health") {
        return { status: 200, body: { ok: true, botUsername: "CalmlyBot" } };
      }
      throw new Error(`unexpected path ${path}`);
    }) as unknown as ApiClient["request"];
    setup(request);
    expect(await call("telegram:createLinkingCode")).toEqual({
      ok: true,
      code: "ABCD1234",
      expiresAt: 1700000900000,
      botUsername: "CalmlyBot",
    });
  });

  it("still returns the code when /telegram/health is unreachable", async () => {
    const request = vi.fn(async (_m: string, path: string) => {
      if (path === "/telegram/linking/code") {
        return { status: 200, body: { code: "ABCD1234", expiresAt: 1700000900000 } };
      }
      throw new ApiNetworkError("offline");
    }) as unknown as ApiClient["request"];
    setup(request);
    expect(await call("telegram:createLinkingCode")).toEqual({
      ok: true,
      code: "ABCD1234",
      expiresAt: 1700000900000,
      botUsername: null,
    });
  });

  it("maps a 429 from code creation to RateLimited", async () => {
    setup(
      vi.fn(async () => {
        throw new ApiHttpError("rate limited", 429, { error: "rate_limited" });
      }) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:createLinkingCode")).toEqual({
      ok: false,
      error: "RateLimited",
    });
  });

  it("maps a network error on code creation to NetworkError", async () => {
    setup(
      vi.fn(async () => {
        throw new ApiNetworkError("offline");
      }) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:createLinkingCode")).toEqual({
      ok: false,
      error: "NetworkError",
    });
  });
});

describe("telegram:unlink", () => {
  it("returns NotSignedIn when no current user", async () => {
    hoisted.state.signedIn = false;
    setup(vi.fn() as unknown as ApiClient["request"]);
    expect(await call("telegram:unlink")).toEqual({
      ok: false,
      error: "NotSignedIn",
    });
  });

  it("happy path", async () => {
    const request = vi.fn(async () => ({ status: 200, body: { ok: true, deleted: 1 } })) as unknown as ApiClient["request"];
    setup(request);
    expect(await call("telegram:unlink")).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("POST", "/telegram/linking/unlink");
  });

  it("maps a network error to NetworkError", async () => {
    setup(
      vi.fn(async () => {
        throw new ApiNetworkError("offline");
      }) as unknown as ApiClient["request"],
    );
    expect(await call("telegram:unlink")).toEqual({
      ok: false,
      error: "NetworkError",
    });
  });
});
