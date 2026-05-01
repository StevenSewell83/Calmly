import { OAuthExchangeError } from "./googleProvider";
import {
  OAuthRefreshError,
  type RefreshArgs,
  type RefreshResult,
} from "./refresh";

// Microsoft Identity Platform v2 — multi-tenant `/common` authority so the
// same client app can sign in work, school, AND personal accounts. Mirror
// of googleProvider.ts; differs in URLs, scope syntax, and the userinfo
// shape (Graph /me vs OpenID Connect userinfo).

const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const AUTH_URL = `${AUTHORITY}/authorize`;
const TOKEN_URL = `${AUTHORITY}/token`;
const ME_URL = "https://graph.microsoft.com/v1.0/me";

export const MICROSOFT_SCOPES = [
  "offline_access",
  "Calendars.Read",
  "User.Read",
  "openid",
  "profile",
  "email",
] as const;

export interface BuildAuthUrlArgs {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
}

// Builds the Microsoft authorization URL. `prompt=consent` is included so a
// re-connect after the user revoked permissions reliably re-issues a
// refresh_token (offline_access scope alone is not enough — MS still
// short-circuits if the consent record is fresh).
export function buildMicrosoftAuthUrl(args: BuildAuthUrlArgs): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", MICROSOFT_SCOPES.join(" "));
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("prompt", "consent");
  if (args.loginHint) u.searchParams.set("login_hint", args.loginHint);
  return u.toString();
}

export interface ExchangeArgs {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}

export interface ExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string;
  idToken: string | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

export async function exchangeMicrosoftCode(
  args: ExchangeArgs,
): Promise<ExchangeResult> {
  const fetchFn = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    code_verifier: args.codeVerifier,
    // The token endpoint is happier when scope echoes the request. Required
    // for personal MSA accounts on /common; harmless for work accounts.
    scope: MICROSOFT_SCOPES.join(" "),
  });
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  let parsed: TokenResponse | null = null;
  try {
    parsed = (await res.json()) as TokenResponse;
  } catch {
    parsed = null;
  }
  if (!res.ok || !parsed) {
    throw new OAuthExchangeError(
      `microsoft token exchange failed (${res.status})`,
      res.status,
      parsed,
    );
  }
  if (!parsed.access_token || !parsed.refresh_token || !parsed.expires_in) {
    // No refresh_token usually means the offline_access scope was rejected
    // (consent not granted) or the app registration is single-tenant.
    throw new OAuthExchangeError(
      "microsoft token response missing required fields",
      200,
      { hasAccess: !!parsed.access_token, hasRefresh: !!parsed.refresh_token },
    );
  }
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresInSec: parsed.expires_in,
    scope: parsed.scope ?? "",
    idToken: parsed.id_token ?? null,
  };
}

// Refresh-grant exchange. Microsoft DOES rotate refresh tokens — every
// refresh response includes a fresh refresh_token; callers MUST persist it
// because the previous one becomes invalid almost immediately.
export async function refreshMicrosoftAccessToken(
  args: RefreshArgs,
): Promise<RefreshResult> {
  const fetchFn = args.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    scope: MICROSOFT_SCOPES.join(" "),
  });
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
    });
  } catch (e) {
    throw new OAuthRefreshError(
      `microsoft refresh network error: ${e instanceof Error ? e.message : String(e)}`,
      "network_error",
      0,
    );
  }
  let parsed: TokenResponse | null = null;
  try {
    parsed = (await res.json()) as TokenResponse;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const errCode =
      typeof (parsed as { error?: unknown } | null)?.error === "string" &&
      (parsed as { error: string }).error === "invalid_grant"
        ? "invalid_grant"
        : "provider_error";
    throw new OAuthRefreshError(
      `microsoft refresh failed (${res.status})`,
      errCode,
      res.status,
    );
  }
  if (!parsed?.access_token || !parsed.expires_in) {
    throw new OAuthRefreshError(
      "microsoft refresh response missing required fields",
      "provider_error",
      200,
    );
  }
  return {
    accessToken: parsed.access_token,
    expiresInSec: parsed.expires_in,
    scope: parsed.scope ?? "",
    idToken: parsed.id_token ?? null,
    refreshToken: parsed.refresh_token ?? null,
  };
}

export interface MicrosoftUserInfo {
  id: string;
  email: string;
}

interface GraphMeResponse {
  id?: string;
  // Work/school accounts populate `mail`; personal MSA leaves it null and
  // exposes the address via `userPrincipalName`. We fall back accordingly.
  mail?: string | null;
  userPrincipalName?: string | null;
}

export async function fetchMicrosoftUserInfo(args: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<MicrosoftUserInfo> {
  const fetchFn = args.fetchImpl ?? fetch;
  const res = await fetchFn(ME_URL, {
    headers: { authorization: `Bearer ${args.accessToken}`, accept: "application/json" },
  });
  if (!res.ok) {
    throw new OAuthExchangeError(
      `microsoft graph /me failed (${res.status})`,
      res.status,
      null,
    );
  }
  const json = (await res.json()) as GraphMeResponse;
  if (!json.id) {
    throw new OAuthExchangeError("microsoft graph /me missing id", 200, json);
  }
  const email = json.mail ?? json.userPrincipalName ?? null;
  if (!email) {
    throw new OAuthExchangeError(
      "microsoft graph /me missing both mail and userPrincipalName",
      200,
      json,
    );
  }
  return { id: json.id, email };
}
