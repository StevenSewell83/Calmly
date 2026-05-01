import type { ApiClient } from "../net/client";
import { ApiHttpError, ApiNetworkError } from "../net/client";
import type { CalendarProvider } from "@calmly/shared";
import { calendarTokens } from "./tokens";
import {
  getLocalCalendarAccount,
  markLocalCalendarAccountStatus,
} from "./localStore";
import { calendarStatusEvents } from "./statusEvents";

// CAL-03 — provider-agnostic access-token refresh.
//
// The desktop main process never persists access tokens to disk; they live
// in this in-memory cache, keyed by accountId. On expiry we POST to the
// server's /oauth/<provider>/refresh, which has the client_secret and
// performs the actual provider exchange. Refresh tokens stay in F-12; the
// server only sees them transiently in the request body.
//
// Failure modes:
//   - Transient (network / 5xx): exponential backoff, capped at 5 min.
//   - Hard (invalid_grant / >5 consecutive transient): mark the account
//     reauth_required and emit a status event so the renderer can prompt.

const MAX_TRANSIENT_FAILURES = 5;
const BASE_BACKOFF_MS = 1_000;
const BACKOFF_CAP_MS = 5 * 60_000;
// Refresh proactively a bit before the access token expires so a request
// doesn't race the expiry boundary.
const EXPIRY_SAFETY_MARGIN_MS = 30_000;

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

interface FailureState {
  consecutive: number;
  // Earliest wall-clock time (ms) when a retry is allowed.
  blockedUntilMs: number;
}

export interface RefreshResponseBody {
  ok: boolean;
  access_token?: string;
  expires_in?: number;
  refresh_token?: string | null;
  error?: string;
}

export type GetAccessTokenError =
  | "no_account"
  | "no_refresh_token"
  | "reauth_required"
  | "transient_failure";

export type GetAccessTokenResult =
  | { ok: true; accessToken: string; expiresAtMs: number }
  | { ok: false; error: GetAccessTokenError };

export interface CalendarRefresh {
  getAccessToken(
    provider: CalendarProvider,
    accountId: string,
  ): Promise<GetAccessTokenResult>;
  // Test/disconnect helper.
  invalidate(accountId: string): void;
}

export interface CreateCalendarRefreshDeps {
  apiClient: ApiClient;
  // Test seam — defaults to Date.now.
  now?: () => number;
  // Test seam — callers can inject a sleep that fast-forwards.
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export function createCalendarRefresh(
  deps: CreateCalendarRefreshDeps,
): CalendarRefresh {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const cache = new Map<string, CachedToken>();
  const failures = new Map<string, FailureState>();

  function backoffFor(consecutive: number): number {
    const base = BASE_BACKOFF_MS * 2 ** Math.min(consecutive, 12);
    return Math.min(base, BACKOFF_CAP_MS);
  }

  function recordFailure(accountId: string): FailureState {
    const prior = failures.get(accountId);
    const next: FailureState = {
      consecutive: (prior?.consecutive ?? 0) + 1,
      blockedUntilMs: now() + backoffFor(prior?.consecutive ?? 0),
    };
    failures.set(accountId, next);
    return next;
  }

  function clearFailures(accountId: string): void {
    failures.delete(accountId);
  }

  function markReauthRequired(accountId: string): void {
    const changed = markLocalCalendarAccountStatus(accountId, "reauth_required");
    if (changed) {
      calendarStatusEvents.notify({ accountId, status: "reauth_required" });
    }
    cache.delete(accountId);
  }

  return {
    invalidate(accountId: string): void {
      cache.delete(accountId);
      failures.delete(accountId);
    },

    async getAccessToken(provider, accountId) {
      const account = getLocalCalendarAccount(accountId);
      if (!account || account.provider !== provider) {
        return { ok: false, error: "no_account" };
      }
      if (account.status === "reauth_required") {
        return { ok: false, error: "reauth_required" };
      }

      // Cache hit if we have a token and it's not within the safety margin.
      const cached = cache.get(accountId);
      if (cached && cached.expiresAtMs - EXPIRY_SAFETY_MARGIN_MS > now()) {
        return {
          ok: true,
          accessToken: cached.accessToken,
          expiresAtMs: cached.expiresAtMs,
        };
      }

      // Backoff gate.
      const f = failures.get(accountId);
      if (f && f.blockedUntilMs > now()) {
        return { ok: false, error: "transient_failure" };
      }

      const refreshToken = calendarTokens.get(provider, accountId);
      if (!refreshToken) {
        markReauthRequired(accountId);
        return { ok: false, error: "no_refresh_token" };
      }

      let body: RefreshResponseBody;
      try {
        const res = await deps.apiClient.request<RefreshResponseBody>(
          "POST",
          `/oauth/${provider}/refresh`,
          { account_id: accountId, refresh_token: refreshToken },
        );
        body = res.body;
      } catch (e) {
        if (e instanceof ApiHttpError) {
          // 410 Gone is the server's signal for invalid_grant — definitive
          // reauth, do not retry.
          if (e.status === 410) {
            log("calendar refresh invalid_grant", { provider, accountId });
            markReauthRequired(accountId);
            return { ok: false, error: "reauth_required" };
          }
          if (e.status === 401) {
            return { ok: false, error: "transient_failure" };
          }
          // 5xx and other 4xx → transient. Backoff.
          const state = recordFailure(accountId);
          if (state.consecutive >= MAX_TRANSIENT_FAILURES) {
            log("calendar refresh: too many transient failures, marking reauth", {
              provider,
              accountId,
              consecutive: state.consecutive,
            });
            markReauthRequired(accountId);
            return { ok: false, error: "reauth_required" };
          }
          return { ok: false, error: "transient_failure" };
        }
        if (e instanceof ApiNetworkError) {
          recordFailure(accountId);
          return { ok: false, error: "transient_failure" };
        }
        log("calendar refresh threw", { err: String(e) });
        recordFailure(accountId);
        return { ok: false, error: "transient_failure" };
      }

      if (!body.ok || !body.access_token || !body.expires_in) {
        recordFailure(accountId);
        return { ok: false, error: "transient_failure" };
      }

      // Microsoft rotates refresh tokens — persist the new one if returned.
      // Google leaves it null and the existing entry stays valid.
      if (body.refresh_token) {
        try {
          calendarTokens.set(provider, accountId, body.refresh_token);
        } catch (e) {
          log("calendar refresh: failed to persist rotated refresh", {
            err: String(e),
          });
          // Don't fail the call — the access token is still usable, and the
          // next refresh will simply fail with invalid_grant if the rotation
          // truly invalidated us.
        }
      }

      const expiresAtMs = now() + body.expires_in * 1_000;
      cache.set(accountId, { accessToken: body.access_token, expiresAtMs });
      clearFailures(accountId);

      // If we were previously reauth_required (stale state), flip back. Most
      // common after the user reconnects but the renderer hasn't refreshed.
      if (account.status !== "connected") {
        const changed = markLocalCalendarAccountStatus(accountId, "connected");
        if (changed) {
          calendarStatusEvents.notify({ accountId, status: "connected" });
        }
      }

      return { ok: true, accessToken: body.access_token, expiresAtMs };
    },
  };
}
