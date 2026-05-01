// Shared refresh-grant types between Google and Microsoft. Both providers
// use the OAuth 2.0 refresh_token grant against the same token endpoints
// they used for the initial auth-code grant; only the token URL and the
// rotation behavior differ.

export interface RefreshArgs {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}

export interface RefreshResult {
  accessToken: string;
  expiresInSec: number;
  scope: string;
  idToken: string | null;
  // Present only when the provider chose to rotate the refresh token.
  // Google does NOT rotate by default (returns null/undefined). Microsoft
  // DOES rotate on every refresh — caller must persist the new value and
  // discard the old.
  refreshToken: string | null;
}

// "invalid_grant" means the refresh token is revoked / expired / the user
// removed consent. The desktop client surfaces this as `reauth_required`
// on the calendar account so the renderer can prompt for reconnect.
// Anything else is recoverable (transient network / 5xx).
export type RefreshErrorCode =
  | "invalid_grant"
  | "provider_error"
  | "network_error";

export class OAuthRefreshError extends Error {
  constructor(
    message: string,
    readonly code: RefreshErrorCode,
    readonly status: number,
  ) {
    super(message);
    this.name = "OAuthRefreshError";
  }
}
