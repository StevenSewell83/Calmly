import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CalendarProvider } from "@calmly/shared";
import { upsertCalendarAccount } from "../../oauth/calendarAccounts";
import { OAuthExchangeError } from "../../oauth/googleProvider";
import { createOAuthState, createPkcePair } from "../../oauth/pkce";
import {
  consumeOauthState,
  createOauthStateRow,
  sweepExpiredOauthStates,
} from "../../oauth/state";
import { issueOauthTicket, redeemOauthTicket } from "../../oauth/tickets";
import { requireSession } from "../../middleware/requireSession";
import { renderOAuthError, renderOAuthSuccess } from "./html";
import type { OAuthRoutesDeps } from "./types";

const RedeemBody = z.object({
  ticket: z.string().min(20).max(256),
});

const CallbackQuery = z.object({
  state: z.string().min(1).max(256),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(128).optional(),
  error_description: z.string().max(512).optional(),
});

// Registers /start, /callback, and /redeem for one provider. The
// management routes (refresh, disconnect) live in manageRoutes.ts.
export function registerConnectRoutes(
  app: FastifyInstance,
  deps: OAuthRoutesDeps,
  redirectUri: string,
): void {
  const { config } = deps;
  const provider = config.provider;

  app.get(
    `/oauth/${provider}/start`,
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser;
      if (!user) {
        reply.code(401).send({ error: "unauthorized" });
        return;
      }
      await sweepExpiredOauthStates(app.pool).catch(() => {});

      const state = createOAuthState();
      const pkce = createPkcePair();
      await createOauthStateRow(app.pool, {
        state,
        userId: user.id,
        provider,
        codeVerifier: pkce.verifier,
        ttlSec: deps.stateTtlSec,
      });

      const url = config.buildAuthUrl({
        clientId: deps.clientId,
        redirectUri,
        state,
        codeChallenge: pkce.challenge,
        loginHint: user.email,
      });
      reply.redirect(url);
    },
  );

  app.get<{ Querystring: z.infer<typeof CallbackQuery> }>(
    `/oauth/${provider}/callback`,
    async (req, reply) => {
      const parsed = CallbackQuery.safeParse(req.query);
      if (!parsed.success) {
        return renderOAuthError({
          reply,
          code: "invalid_request",
          description: "The callback URL was malformed.",
        });
      }
      const q = parsed.data;
      if (q.error) {
        return renderOAuthError({
          reply,
          code: q.error,
          description: q.error_description ?? null,
        });
      }
      if (!q.code) {
        return renderOAuthError({
          reply,
          code: "missing_code",
          description: null,
        });
      }

      const consumed = await consumeOauthState(app.pool, {
        state: q.state,
        provider,
      });
      if (!consumed) {
        return renderOAuthError({
          reply,
          code: "state_mismatch",
          description: null,
        });
      }

      let exchange;
      try {
        exchange = await config.exchangeCode({
          clientId: deps.clientId,
          clientSecret: deps.clientSecret,
          redirectUri,
          code: q.code,
          codeVerifier: consumed.codeVerifier,
          fetchImpl: deps.fetchImpl,
        });
      } catch (err) {
        req.log.warn(
          {
            status: err instanceof OAuthExchangeError ? err.status : null,
            provider,
          },
          "oauth token exchange failed",
        );
        return renderOAuthError({
          reply,
          code: "token_exchange_failed",
          description: null,
        });
      }

      let userInfo;
      try {
        userInfo = await config.fetchUserInfo({
          accessToken: exchange.accessToken,
          fetchImpl: deps.fetchImpl,
        });
      } catch (err) {
        req.log.warn(
          {
            status: err instanceof OAuthExchangeError ? err.status : null,
            provider,
          },
          "oauth userinfo failed",
        );
        return renderOAuthError({
          reply,
          code: "userinfo_failed",
          description: null,
        });
      }

      const account = await upsertCalendarAccount(app.pool, {
        userId: consumed.userId,
        provider,
        externalAccountId: userInfo.externalAccountId,
        email: userInfo.email,
      });

      const issued = await issueOauthTicket({
        pool: app.pool,
        secret: deps.ticketSecret,
        userId: consumed.userId,
        accountId: account.id,
        provider,
        refreshToken: exchange.refreshToken,
        accessToken: exchange.accessToken,
        expiresInSec: exchange.expiresInSec,
        ticketTtlSec: deps.ticketTtlSec,
      });

      renderOAuthSuccess({ reply, provider, ticket: issued.ticket });
    },
  );

  app.post(
    `/oauth/${provider}/redeem`,
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser;
      if (!user) {
        reply.code(401).send({ ok: false, error: "unauthorized" });
        return;
      }
      const parsed = RedeemBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ ok: false, error: "invalid_ticket" });
        return;
      }

      const result = await redeemOauthTicket({
        pool: app.pool,
        secret: deps.ticketSecret,
        userId: user.id,
        provider,
        ticket: parsed.data.ticket,
      });

      if (!result.ok) {
        reply.code(result.error === "invalid_ticket" ? 400 : 410).send({
          ok: false,
          error: result.error,
        });
        return;
      }

      const accountRow = await app.pool.query<{
        id: string;
        provider: CalendarProvider;
        external_account_id: string;
        email: string;
        status: "connected" | "disconnected" | "error" | "reauth_required";
      }>(
        `SELECT id, provider, external_account_id, email, status
           FROM calendar_accounts WHERE id = $1 AND user_id = $2`,
        [result.data.accountId, user.id],
      );
      const acct = accountRow.rows[0];
      if (!acct) {
        reply.code(410).send({ ok: false, error: "ticket_already_redeemed" });
        return;
      }

      return {
        ok: true as const,
        account: {
          id: acct.id,
          provider: acct.provider,
          external_account_id: acct.external_account_id,
          email: acct.email,
          status: acct.status,
        },
        refresh_token: result.data.refreshToken,
        access_token: result.data.accessToken,
        expires_in: result.data.expiresInSec,
      };
    },
  );
}
