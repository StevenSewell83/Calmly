import type { CalendarAccount } from "../model/calendar";

// Wire shape returned by POST /oauth/{provider}/redeem after the desktop app
// presents a one-shot ticket received via the calmly://oauth/<provider>/done
// deep-link. Refresh tokens MUST be persisted via the F-12 secret store and
// never written into log / telemetry / sync replicas.
export interface OAuthRedeemSuccess {
  ok: true;
  account: CalendarAccount;
  refresh_token: string;
  access_token: string;
  // Seconds until the access_token expires, as returned by the provider.
  expires_in: number;
}

export type OAuthRedeemErrorCode =
  | "invalid_ticket"
  | "ticket_expired"
  | "ticket_already_redeemed"
  | "ticket_user_mismatch"
  | "unauthorized"
  | "internal_error";

export interface OAuthRedeemFailure {
  ok: false;
  error: OAuthRedeemErrorCode;
}

export type OAuthRedeemResponse = OAuthRedeemSuccess | OAuthRedeemFailure;

// Result surfaced from main → renderer for desktop calendar.connect* calls.
export type CalendarConnectResult =
  | { ok: true; account: CalendarAccount }
  | {
      ok: false;
      error:
        | "not_signed_in"
        | "browser_open_failed"
        | "deeplink_timeout"
        | "redeem_failed"
        | "secret_store_failed"
        | "cancelled"
        | "internal_error";
    };
