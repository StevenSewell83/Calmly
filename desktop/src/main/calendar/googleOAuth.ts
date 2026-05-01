import type { ApiClient } from "../net/client";
import { ApiHttpError, ApiNetworkError } from "../net/client";
import { secretStore } from "../security/secretStore";
import {
  upsertLocalCalendarAccount,
  type LocalCalendarAccount,
} from "./localStore";
import type {
  CalendarConnectResult,
  OAuthRedeemResponse,
} from "@calmly/shared";

// Wait this long for the calmly:// deep-link to come back from the server
// callback page. Tuned so a slow OAuth dance still fits but a forgotten tab
// doesn't pin the connect call open forever.
export const DEEPLINK_TIMEOUT_MS = 5 * 60 * 1000;

export interface CalendarDeepLinkSubscription {
  // Returns an unsubscribe.
  (
    handler: (payload: {
      provider: "google" | "microsoft";
      ticket: string;
    }) => void,
  ): () => void;
}

export interface ConnectGoogleDeps {
  apiBaseUrl: string;
  apiClient: ApiClient;
  openExternal: (url: string) => Promise<void>;
  // Bridge into bootstrap/deeplinks.ts onCalendarOAuth()
  subscribeDeepLink: CalendarDeepLinkSubscription;
  // Test seam — defaults to 5 min.
  timeoutMs?: number;
  // Test seam — defaults to a real setTimeout.
  schedule?: (cb: () => void, ms: number) => () => void;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export type ConnectGoogleStarter = () => Promise<CalendarConnectResult>;

// Coordinates the desktop side of the Google calendar OAuth flow:
//
//   1. open the server's /oauth/google/start in the user's default browser
//   2. wait for calmly://oauth/google/done?ticket=...  (deep-link)
//   3. POST /oauth/google/redeem with the ticket
//   4. persist the refresh_token in the F-12 secret store
//   5. mirror the account into local calendar_accounts
export function createConnectGoogle(
  deps: ConnectGoogleDeps,
): ConnectGoogleStarter {
  const log = deps.log ?? (() => {});
  const timeoutMs = deps.timeoutMs ?? DEEPLINK_TIMEOUT_MS;
  const schedule =
    deps.schedule ??
    ((cb: () => void, ms: number) => {
      const t = setTimeout(cb, ms);
      return () => clearTimeout(t);
    });

  return async function connectGoogle(): Promise<CalendarConnectResult> {
    const startUrl = `${deps.apiBaseUrl.replace(/\/$/, "")}/oauth/google/start`;

    let ticket: string;
    try {
      ticket = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const cancelTimer = schedule(() => {
          if (settled) return;
          settled = true;
          unsubscribe();
          reject(new DeepLinkTimeoutError());
        }, timeoutMs);

        const unsubscribe = deps.subscribeDeepLink((payload) => {
          if (payload.provider !== "google") return;
          if (settled) return;
          settled = true;
          cancelTimer();
          unsubscribe();
          resolve(payload.ticket);
        });

        // Open the browser AFTER the subscription is installed so we never
        // race a too-fast deep-link.
        deps.openExternal(startUrl).catch((err) => {
          if (settled) return;
          settled = true;
          cancelTimer();
          unsubscribe();
          reject(new BrowserOpenError(String(err)));
        });
      });
    } catch (e) {
      if (e instanceof DeepLinkTimeoutError) {
        return { ok: false, error: "deeplink_timeout" };
      }
      if (e instanceof BrowserOpenError) {
        log("connectGoogle browser open failed", { err: e.message });
        return { ok: false, error: "browser_open_failed" };
      }
      log("connectGoogle unexpected error", { err: String(e) });
      return { ok: false, error: "internal_error" };
    }

    let body: OAuthRedeemResponse;
    try {
      const res = await deps.apiClient.request<OAuthRedeemResponse>(
        "POST",
        "/oauth/google/redeem",
        { ticket },
      );
      body = res.body;
    } catch (e) {
      if (e instanceof ApiHttpError) {
        if (e.status === 401) return { ok: false, error: "not_signed_in" };
        return { ok: false, error: "redeem_failed" };
      }
      if (e instanceof ApiNetworkError) {
        return { ok: false, error: "redeem_failed" };
      }
      log("connectGoogle redeem error", { err: String(e) });
      return { ok: false, error: "internal_error" };
    }

    if (!body.ok) {
      return { ok: false, error: "redeem_failed" };
    }

    try {
      secretStore.set(
        `calendar.google.refresh_token:${body.account.id}`,
        body.refresh_token,
      );
    } catch (e) {
      log("connectGoogle secret store failed", { err: String(e) });
      return { ok: false, error: "secret_store_failed" };
    }

    // Mirror connection metadata locally so the renderer can render a
    // status pill without a server round-trip. Tokens never touch this
    // table — refresh lives in `secrets`, access is held in memory only
    // (CAL-03 will manage refresh→access lifecycle).
    let local: LocalCalendarAccount;
    try {
      local = upsertLocalCalendarAccount({
        id: body.account.id,
        provider: body.account.provider,
        external_account_id: body.account.external_account_id,
        email: body.account.email,
        status: body.account.status,
      });
    } catch (e) {
      log("connectGoogle local mirror write failed", { err: String(e) });
      return { ok: false, error: "internal_error" };
    }

    return {
      ok: true,
      account: {
        id: local.id,
        provider: local.provider,
        external_account_id: local.external_account_id,
        email: local.email,
        status: local.status,
      },
    };
  };
}

class DeepLinkTimeoutError extends Error {
  constructor() {
    super("deeplink timeout");
    this.name = "DeepLinkTimeoutError";
  }
}

class BrowserOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserOpenError";
  }
}
