import type { CalendarProvider } from "@calmly/shared";
import type { RefreshArgs, RefreshResult } from "../../oauth/refresh";

// Shared between plugin.ts (entry), connectRoutes.ts (start/callback/redeem),
// and manageRoutes.ts (refresh/disconnect). Extracted so the route handlers
// can import the types without re-introducing a cycle.

export interface OAuthExchangeResult {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
  scope: string;
  idToken: string | null;
}

export interface OAuthUserInfo {
  externalAccountId: string;
  email: string;
}

export interface OAuthProviderConfig {
  // Slug used in route paths and as the `provider` enum value.
  provider: CalendarProvider;
  // Build the provider's authorization URL for the start step.
  buildAuthUrl(args: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
    loginHint?: string | null;
  }): string;
  // Exchange the authorization code for refresh + access tokens.
  exchangeCode(args: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
    fetchImpl?: typeof fetch;
  }): Promise<OAuthExchangeResult>;
  // Resolve the provider's user identity from the access token.
  fetchUserInfo(args: {
    accessToken: string;
    fetchImpl?: typeof fetch;
  }): Promise<OAuthUserInfo>;
  // Mint a fresh access token from a refresh token. Implementations throw
  // OAuthRefreshError; the route layer maps the error code into the wire
  // shape so the desktop client can decide whether to surface
  // `reauth_required` or just back off.
  refreshAccessToken(args: RefreshArgs): Promise<RefreshResult>;
}

export interface OAuthRoutesDeps {
  config: OAuthProviderConfig;
  clientId: string;
  clientSecret: string;
  redirectBaseUrl: string;
  ticketSecret: string;
  stateTtlSec: number;
  ticketTtlSec: number;
  fetchImpl?: typeof fetch;
}
