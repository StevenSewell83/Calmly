// Google OAuth 2.0 provider config + token + userinfo helpers.
// Microsoft mirrors this in microsoftProvider.ts (CAL-02).

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
  "profile",
] as const;

export interface BuildAuthUrlArgs {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
}

// Builds the Google authorization URL. Forces access_type=offline +
// prompt=consent so a refresh_token is issued even on re-consent flows.
export function buildGoogleAuthUrl(args: BuildAuthUrlArgs): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("include_granted_scopes", "true");
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

export class OAuthExchangeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "OAuthExchangeError";
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

export async function exchangeGoogleCode(
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
      `google token exchange failed (${res.status})`,
      res.status,
      parsed,
    );
  }
  if (!parsed.access_token || !parsed.refresh_token || !parsed.expires_in) {
    // Missing refresh_token usually means access_type=offline+prompt=consent
    // wasn't honored. Surface as a hard error so it gets caught in tests.
    throw new OAuthExchangeError(
      "google token response missing required fields",
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

export interface GoogleUserInfo {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export async function fetchGoogleUserInfo(args: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleUserInfo> {
  const fetchFn = args.fetchImpl ?? fetch;
  const res = await fetchFn(USERINFO_URL, {
    headers: { authorization: `Bearer ${args.accessToken}`, accept: "application/json" },
  });
  if (!res.ok) {
    throw new OAuthExchangeError(
      `google userinfo failed (${res.status})`,
      res.status,
      null,
    );
  }
  const json = (await res.json()) as {
    sub?: string;
    email?: string;
    email_verified?: boolean;
  };
  if (!json.sub || !json.email) {
    throw new OAuthExchangeError(
      "google userinfo missing sub/email",
      200,
      json,
    );
  }
  return {
    sub: json.sub,
    email: json.email,
    emailVerified: json.email_verified === true,
  };
}
