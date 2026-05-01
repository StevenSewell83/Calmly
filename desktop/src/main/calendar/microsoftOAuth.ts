import {
  createConnectProvider,
  DEEPLINK_TIMEOUT_MS,
  type CalendarDeepLinkSubscription,
  type ConnectStarter,
} from "./connectProvider";
import type { ApiClient } from "../net/client";

export { DEEPLINK_TIMEOUT_MS };

export type { CalendarDeepLinkSubscription };

export interface ConnectMicrosoftDeps {
  apiBaseUrl: string;
  apiClient: ApiClient;
  openExternal: (url: string) => Promise<void>;
  subscribeDeepLink: CalendarDeepLinkSubscription;
  timeoutMs?: number;
  schedule?: (cb: () => void, ms: number) => () => void;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

export type ConnectMicrosoftStarter = ConnectStarter;

export function createConnectMicrosoft(
  deps: ConnectMicrosoftDeps,
): ConnectMicrosoftStarter {
  return createConnectProvider({ provider: "microsoft", ...deps });
}
