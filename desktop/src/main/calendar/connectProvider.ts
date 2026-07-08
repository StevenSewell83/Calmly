import type { ApiClient } from "../net/client";
import { ApiHttpError, ApiNetworkError } from "../net/client";
import { calendarTokens } from "./tokens";
import {
  upsertLocalCalendarAccount,
  type LocalCalendarAccount,
} from "./localStore";
import type {
  CalendarConnectResult,
  CalendarProvider,
  OAuthRedeemResponse,
} from "@calmly/shared";

// Wait this long for the calmly:// deep-link to come back from the server
// callback page. Tuned so a slow OAuth dance still fits but a forgotten tab
// doesn't pin the connect call open forever.
export const DEEPLINK_TIMEOUT_MS = 5 * 60 * 1000;

export interface CalendarDeepLinkSubscription {
  // Returns an unsubscribe.
  (
    handler: (payload: { provider: CalendarProvider; ticket: string }) => void,
  ): () => void;
}

export interface ConnectProviderDeps {
  provider: CalendarProvider;
  apiBaseUrl: string;
  apiClient: ApiClient;
  openExternal: (url: string) => Promise<void>;
  subscribeDeepLink: CalendarDeepLinkSubscription;
  // Test seam — defaults to 5 min.
  timeoutMs?: number;
  // Test seam — defaults to a real setTimeout.
  schedule?: (cb: () => void, ms: number) => () => void;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export type ConnectStarter = () => Promise<CalendarConnectResult>;

// Coordinates the desktop side of an OAuth flow against either Google
// (CAL-01) or Microsoft (CAL-02):
//
//   1. open the server's /oauth/<provider>/start in the user's default browser
//   2. wait for calmly://oauth/<provider>/done?ticket=...
//   3. POST /oauth/<provider>/redeem with the ticket
//   4. persist the refresh_token in the F-12 secret store
//   5. mirror the account into local calendar_accounts
export function createConnectProvider(
  deps: ConnectProviderDeps,
): ConnectStarter {
  const provider = deps.provider;
  const log = deps.log ?? (() => {});
  const timeoutMs = deps.timeoutMs ?? DEEPLINK_TIMEOUT_MS;
  const schedule =
    deps.schedule ??
    ((cb: () => void, ms: number) => {
      const t = setTimeout(cb, ms);
      return () => clearTimeout(t);
    });

  return async function connect(): Promise<CalendarConnectResult> {
    const base = deps.apiBaseUrl.replace(/\/$/, "");
    const startUrl = `${base}/oauth/${provider}/start`;
    const redeemPath = `/oauth/${provider}/redeem`;

    let ticket: string;
    try {
      ticket = await waitForTicket({
        provider,
        startUrl,
        openExternal: deps.openExternal,
        subscribeDeepLink: deps.subscribeDeepLink,
        schedule,
        timeoutMs,
      });
    } catch (e) {
      if (e instanceof DeepLinkTimeoutError) {
        return { ok: false, error: "deeplink_timeout" };
      }
      if (e instanceof BrowserOpenError) {
        log(`connect${cap(provider)} browser open failed`, { err: e.message });
        return { ok: false, error: "browser_open_failed" };
      }
      log(`connect${cap(provider)} unexpected error`, { err: String(e) });
      return { ok: false, error: "internal_error" };
    }

    let body: OAuthRedeemResponse;
    try {
      const res = await deps.apiClient.request<OAuthRedeemResponse>(
        "POST",
        redeemPath,
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
      log(`connect${cap(provider)} redeem error`, { err: String(e) });
      return { ok: false, error: "internal_error" };
    }

    if (!body.ok) {
      return { ok: false, error: "redeem_failed" };
    }

    try {
      calendarTokens.set(provider, body.account.id, body.refresh_token);
    } catch (e) {
      log(`connect${cap(provider)} secret store failed`, { err: String(e) });
      return { ok: false, error: "secret_store_failed" };
    }

    // Mirror connection metadata locally so the renderer can render a status
    // pill without a server round-trip. Tokens never touch this table —
    // refresh lives in `secrets`, access is held in memory only (CAL-03 will
    // manage refresh→access lifecycle).
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
      log(`connect${cap(provider)} local mirror write failed`, {
        err: String(e),
      });
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

interface WaitForTicketArgs {
  provider: CalendarProvider;
  startUrl: string;
  openExternal: (url: string) => Promise<void>;
  subscribeDeepLink: CalendarDeepLinkSubscription;
  schedule: (cb: () => void, ms: number) => () => void;
  timeoutMs: number;
}

function waitForTicket(args: WaitForTicketArgs): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const cancelTimer = args.schedule(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new DeepLinkTimeoutError());
    }, args.timeoutMs);

    const unsubscribe = args.subscribeDeepLink((payload) => {
      if (payload.provider !== args.provider) return;
      if (settled) return;
      settled = true;
      cancelTimer();
      unsubscribe();
      resolve(payload.ticket);
    });

    // Open the browser AFTER the subscription is installed so we never race
    // a too-fast deep-link.
    args.openExternal(args.startUrl).catch((err) => {
      if (settled) return;
      settled = true;
      cancelTimer();
      unsubscribe();
      reject(new BrowserOpenError(String(err)));
    });
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
