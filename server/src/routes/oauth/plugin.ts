import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { registerConnectRoutes } from "./connectRoutes";
import { registerManageRoutes } from "./manageRoutes";
import type { OAuthRoutesDeps } from "./types";

export type {
  OAuthExchangeResult,
  OAuthProviderConfig,
  OAuthRoutesDeps,
  OAuthUserInfo,
} from "./types";

// Provider-agnostic OAuth route plugin. Both Google (CAL-01) and Microsoft
// (CAL-02) reuse this; their differences are confined to the small
// OAuthProviderConfig adapter — auth URL builder, code exchange, userinfo
// fetch, and refresh-grant exchange.
//
// Three route groups under /oauth/<provider>/:
//   - connect: /start → /callback → /redeem (browser dance + ticket pickup)
//   - manage:  /refresh, /disconnect       (CAL-03 lifecycle)
export function oauthProviderPlugin(deps: OAuthRoutesDeps): FastifyPluginAsync {
  const provider = deps.config.provider;
  const redirectUri = `${deps.redirectBaseUrl.replace(/\/$/, "")}/oauth/${provider}/callback`;

  return async function oauthRoutes(app: FastifyInstance): Promise<void> {
    registerConnectRoutes(app, deps, redirectUri);
    registerManageRoutes(app, deps);
  };
}
