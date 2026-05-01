import { describe, expect, it } from "vitest";
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftUserInfo,
  MICROSOFT_SCOPES,
} from "../microsoftProvider";
import { OAuthExchangeError } from "../googleProvider";

describe("buildMicrosoftAuthUrl", () => {
  it("targets the multi-tenant /common authority", () => {
    const url = buildMicrosoftAuthUrl({
      clientId: "client-123",
      redirectUri: "https://example.com/oauth/microsoft/callback",
      state: "state-xyz",
      codeChallenge: "challenge-abc",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
  });

  it("includes all required parameters and forces consent", () => {
    const url = buildMicrosoftAuthUrl({
      clientId: "client-123",
      redirectUri: "https://example.com/oauth/microsoft/callback",
      state: "state-xyz",
      codeChallenge: "challenge-abc",
    });
    const u = new URL(url);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe("client-123");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "https://example.com/oauth/microsoft/callback",
    );
    expect(u.searchParams.get("scope")).toBe(MICROSOFT_SCOPES.join(" "));
    expect(u.searchParams.get("state")).toBe("state-xyz");
    expect(u.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("response_mode")).toBe("query");
  });

  it("declares offline_access in the scope list (refresh-token requirement)", () => {
    expect(MICROSOFT_SCOPES).toContain("offline_access");
    expect(MICROSOFT_SCOPES).toContain("Calendars.Read");
  });

  it("includes login_hint only when provided", () => {
    const a = buildMicrosoftAuthUrl({
      clientId: "c",
      redirectUri: "https://x/y",
      state: "s",
      codeChallenge: "c",
    });
    expect(new URL(a).searchParams.get("login_hint")).toBe(null);

    const b = buildMicrosoftAuthUrl({
      clientId: "c",
      redirectUri: "https://x/y",
      state: "s",
      codeChallenge: "c",
      loginHint: "alex@example.com",
    });
    expect(new URL(b).searchParams.get("login_hint")).toBe("alex@example.com");
  });
});

describe("exchangeMicrosoftCode", () => {
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
      scope: "openid email Calendars.Read",
      id_token: "id-token",
    });
    const r = await exchangeMicrosoftCode({
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
      scope: "openid email Calendars.Read",
      idToken: "id-token",
    });
  });

  it("throws when refresh_token is missing (offline_access not granted)", async () => {
    const fetchImpl = fakeFetchOk({
      access_token: "at",
      expires_in: 3599,
    });
    await expect(
      exchangeMicrosoftCode({
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
      exchangeMicrosoftCode({
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

describe("fetchMicrosoftUserInfo", () => {
  function fakeFetchJson(body: Record<string, unknown>): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
  }

  it("returns id + mail for work/school accounts", async () => {
    const fetchImpl = fakeFetchJson({
      id: "ms-object-id-1",
      mail: "alex@contoso.com",
      userPrincipalName: "alex@contoso.com",
    });
    const r = await fetchMicrosoftUserInfo({ accessToken: "at", fetchImpl });
    expect(r).toEqual({ id: "ms-object-id-1", email: "alex@contoso.com" });
  });

  it("falls back to userPrincipalName when mail is null (personal MSA)", async () => {
    const fetchImpl = fakeFetchJson({
      id: "ms-msa-1",
      mail: null,
      userPrincipalName: "alex@outlook.com",
    });
    const r = await fetchMicrosoftUserInfo({ accessToken: "at", fetchImpl });
    expect(r).toEqual({ id: "ms-msa-1", email: "alex@outlook.com" });
  });

  it("throws when both mail and userPrincipalName are missing", async () => {
    const fetchImpl = fakeFetchJson({ id: "ms-x" });
    await expect(
      fetchMicrosoftUserInfo({ accessToken: "at", fetchImpl }),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });

  it("throws when id is missing", async () => {
    const fetchImpl = fakeFetchJson({
      mail: "alex@contoso.com",
    });
    await expect(
      fetchMicrosoftUserInfo({ accessToken: "at", fetchImpl }),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });

  it("throws on non-2xx graph response", async () => {
    const fetchImpl = (async () =>
      new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
    await expect(
      fetchMicrosoftUserInfo({ accessToken: "at", fetchImpl }),
    ).rejects.toBeInstanceOf(OAuthExchangeError);
  });
});
