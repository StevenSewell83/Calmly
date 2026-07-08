import type { FastifyPluginAsync } from "fastify";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  GOOGLE_SCOPES,
  refreshGoogleAccessToken,
} from "../../oauth/googleProvider";
import { oauthProviderPlugin, type OAuthProviderConfig } from "./plugin";

export interface GoogleOAuthDeps {
  clientId: string;
  clientSecret: string;
  redirectBaseUrl: string;
  ticketSecret: string;
  stateTtlSec: number;
  ticketTtlSec: number;
  fetchImpl?: typeof fetch;
}

const googleProviderConfig: OAuthProviderConfig = {
  provider: "google",
  buildAuthUrl: buildGoogleAuthUrl,
  exchangeCode: exchangeGoogleCode,
  fetchUserInfo: async (args) => {
    const r = await fetchGoogleUserInfo(args);
    return { externalAccountId: r.sub, email: r.email };
  },
  refreshAccessToken: refreshGoogleAccessToken,
};

// Re-exported so tests + docs that want the canonical scope list can import
// it from one place.
export { GOOGLE_SCOPES };

export function googleOAuthPlugin(deps: GoogleOAuthDeps): FastifyPluginAsync {
  return oauthProviderPlugin({
    config: googleProviderConfig,
    clientId: deps.clientId,
    clientSecret: deps.clientSecret,
    redirectBaseUrl: deps.redirectBaseUrl,
    ticketSecret: deps.ticketSecret,
    stateTtlSec: deps.stateTtlSec,
    ticketTtlSec: deps.ticketTtlSec,
    fetchImpl: deps.fetchImpl,
  });
}
