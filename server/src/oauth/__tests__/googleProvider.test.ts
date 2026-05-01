import { describe, expect, it } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  GOOGLE_SCOPES,
  OAuthExchangeError,
} from "../googleProvider";

describe("buildGoogleAuthUrl", () => {
  it("includes all required parameters and forces offline + consent", () => {
    const url = buildGoogleAuthUrl({
      clientId: "client-123",
      redirectUri: "https://example.com/oauth/google/callback",
      state: "state-xyz",
      codeChallenge: "challenge-abc",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("client-123");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://example.com/oauth/google/callback",
    );
    expect(u.searchParams.get("scope")).toBe(GOOGLE_SCOPES.join(" "));
    expect(u.searchParams.get("state")).toBe("state-xyz");
    expect(u.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
  });

  it("includes login_hint only when provided", () => {
    const a = buildGoogleAuthUrl({
      clientId: "c",
      redirectUri: "https://x/y",
      state: "s",
      codeChallenge: "c",
    });
    expect(new URL(a).searchParams.get("login_hint")).toBe(null);

    const b = buildGoogleAuthUrl({
      clientId: "c",
      redirectUri: "https://x/y",
      state: "s",
      codeChallenge: "c",
      loginHint: "alex@example.com",
    });
    expect(new URL(b).searchParams.get("login_hint")).toBe("alex@example.com");
  });
});

describe("exchangeGoogleCode", () => {
  function fakeFetchOk(body: Record<string, unknown>): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }

  it("returns parsed tokens on success", async () => {
    const fetchImpl = fakeFetchOk({
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
      scope: "openid email",
      id_token: "id-token",
    });
    const r = await exchangeGoogleCode({
      clientId: "c",
      clientSecret: "s",
      redirectUri: "https://x/y",
      code: "auth-code",
      codeVerifier: "v",
      fetchImpl,
    });
    expect(r).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresInSec: 3599,
      scope: "openid email",
      idToken: "id-token",
    });
  });

  it("throws when refresh_token is missing (offline+consent not honored)", async () => {
    const fetchImpl = fakeFetchOk({
      access_token: "at",
      expires_in: 3599,
    });
    await expect(
      exchangeGoogleCode({
        clientId: "c",
        clientSecret: "s",
        redirectUri: "https://x/y",
        code: "auth-code",
        codeVerifier: "v",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });

  it("throws on non-2xx", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCode({
        clientId: "c",
        clientSecret: "s",
        redirectUri: "https://x/y",
        code: "auth-code",
        codeVerifier: "v",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });
});

describe("fetchGoogleUserInfo", () => {
  it("returns sub + email on success", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          sub: "google-user-1",
          email: "alex@example.com",
          email_verified: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const r = await fetchGoogleUserInfo({ accessToken: "at", fetchImpl });
    expect(r).toEqual({
      sub: "google-user-1",
      email: "alex@example.com",
      emailVerified: true,
    });
  });

  it("throws when sub or email is missing", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ sub: "x" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    await expect(
      fetchGoogleUserInfo({ accessToken: "at", fetchImpl }),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });
});
