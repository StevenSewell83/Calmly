import {
  createConnectProvider,
  DEEPLINK_TIMEOUT_MS,
  type CalendarDeepLinkSubscription,
  type ConnectStarter,
} from "./connectProvider";
import type { ApiClient } from "../net/client";

// Backward-compat naming so existing callers don't churn. CAL-02 added the
// generic createConnectProvider; this is the Google-flavoured factory.

export { DEEPLINK_TIMEOUT_MS };

export type { CalendarDeepLinkSubscription };

export interface ConnectGoogleDeps {
  apiBaseUrl: string;
  apiClient: ApiClient;
  openExternal: (url: string) => Promise<void>;
  subscribeDeepLink: CalendarDeepLinkSubscription;
  timeoutMs?: number;
  schedule?: (cb: () => void, ms: number) => () => void;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export type ConnectGoogleStarter = ConnectStarter;

export function createConnectGoogle(
  deps: ConnectGoogleDeps,
): ConnectGoogleStarter {
  return createConnectProvider({ provider: "google", ...deps });
}
