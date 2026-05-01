import { describe, expect, it } from "vitest";
import { refreshGoogleAccessToken } from "../googleProvider";
import { refreshMicrosoftAccessToken } from "../microsoftProvider";
import { OAuthRefreshError } from "../refresh";

function fakeFetchOk(body: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function fakeFetch(status: number, body: Record<string, unknown>): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("refreshGoogleAccessToken", () => {
  it("returns the new access token + null refresh_token (Google does not rotate)", async () => {
    const r = await refreshGoogleAccessToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "rt-existing",
      fetchImpl: fakeFetchOk({ access_token: "at-new", expires_in: 3599 }),
    });
    expect(r).toEqual({
      accessToken: "at-new",
      expiresInSec: 3599,
      scope: "",
      idToken: null,
      refreshToken: null,
    });
  });

  it("propagates a rotated refresh_token if the provider returned one", async () => {
    const r = await refreshGoogleAccessToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "rt-existing",
      fetchImpl: fakeFetchOk({
        access_token: "at-new",
        expires_in: 3599,
        refresh_token: "rt-rotated",
      }),
    });
    expect(r.refreshToken).toBe("rt-rotated");
  });

  it("throws invalid_grant when the provider returns 400 with that error", async () => {
    try {
      await refreshGoogleAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt",
        fetchImpl: fakeFetch(400, { error: "invalid_grant" }),
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthRefreshError);
      expect((e as OAuthRefreshError).code).toBe("invalid_grant");
    }
  });

  it("throws provider_error on a 5xx", async () => {
    try {
      await refreshGoogleAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt",
        fetchImpl: fakeFetch(503, {}),
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthRefreshError);
      expect((e as OAuthRefreshError).code).toBe("provider_error");
    }
  });

  it("throws network_error when fetch itself rejects", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("ENOTFOUND");
    }) as unknown as typeof fetch;
    try {
      await refreshGoogleAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt",
        fetchImpl,
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthRefreshError);
      expect((e as OAuthRefreshError).code).toBe("network_error");
    }
  });
});

describe("refreshMicrosoftAccessToken", () => {
  it("returns the new access token AND the rotated refresh token (MS rotates)", async () => {
    const r = await refreshMicrosoftAccessToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "rt-existing",
      fetchImpl: fakeFetchOk({
        access_token: "at-new",
        expires_in: 3599,
        refresh_token: "rt-rotated",
        scope: "Calendars.Read",
      }),
    });
    expect(r).toEqual({
      accessToken: "at-new",
      expiresInSec: 3599,
      scope: "Calendars.Read",
      idToken: null,
      refreshToken: "rt-rotated",
    });
  });

  it("throws invalid_grant on 400 invalid_grant", async () => {
    try {
      await refreshMicrosoftAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt",
        fetchImpl: fakeFetch(400, { error: "invalid_grant" }),
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthRefreshError);
      expect((e as OAuthRefreshError).code).toBe("invalid_grant");
    }
  });

  it("throws provider_error on missing access_token in 200 response", async () => {
    try {
      await refreshMicrosoftAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt",
        fetchImpl: fakeFetchOk({ expires_in: 3599 }),
      });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthRefreshError);
      expect((e as OAuthRefreshError).code).toBe("provider_error");
    }
  });
});
