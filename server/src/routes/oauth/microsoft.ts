import type { FastifyPluginAsync } from "fastify";
import {
  buildMicrosoftAuthUrl,
  exchangeMicrosoftCode,
  fetchMicrosoftUserInfo,
  MICROSOFT_SCOPES,
  refreshMicrosoftAccessToken,
} from "../../oauth/microsoftProvider";
import {
  oauthProviderPlugin,
  type OAuthProviderConfig,
} from "./plugin";

export interface MicrosoftOAuthDeps {
  clientId: string;
  clientSecret: string;
  redirectBaseUrl: string;
  ticketSecret: string;
  stateTtlSec: number;
  ticketTtlSec: number;
  fetchImpl?: typeof fetch;
}

const microsoftProviderConfig: OAuthProviderConfig = {
  provider: "microsoft",
  buildAuthUrl: buildMicrosoftAuthUrl,
  exchangeCode: exchangeMicrosoftCode,
  fetchUserInfo: async (args) => {
    const r = await fetchMicrosoftUserInfo(args);
    return { externalAccountId: r.id, email: r.email };
  },
  refreshAccessToken: refreshMicrosoftAccessToken,
};

export { MICROSOFT_SCOPES };

export function microsoftOAuthPlugin(
  deps: MicrosoftOAuthDeps,
): FastifyPluginAsync {
  return oauthProviderPlugin({
    config: microsoftProviderConfig,
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    redirectBaseUrl: deps.redirectBaseUrl,
    ticketSecret: deps.ticketSecret,
    stateTtlSec: deps.stateTtlSec,
    ticketTtlSec: deps.ticketTtlSec,
    fetchImpl: deps.fetchImpl,
  });
}
