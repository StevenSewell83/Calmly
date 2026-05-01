import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { upsertCalendarAccount } from "../../oauth/calendarAccounts";
import {
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  OAuthExchangeError,
} from "../../oauth/googleProvider";
import { createOAuthState, createPkcePair } from "../../oauth/pkce";
import {
  consumeOauthState,
  createOauthStateRow,
  sweepExpiredOauthStates,
} from "../../oauth/state";
import { issueOauthTicket, redeemOauthTicket } from "../../oauth/tickets";
import { requireSession } from "../../middleware/requireSession";
import { renderOAuthError, renderOAuthSuccess } from "./html";

export interface GoogleOAuthDeps {
  clientId: string;
  clientSecret: string;
  // The base URL the OAuth provider redirects back to. The full redirect
  // URI is `${redirectBaseUrl}/oauth/google/callback`.
  redirectBaseUrl: string;
  ticketSecret: string;
  stateTtlSec: number;
  ticketTtlSec: number;
  // Test seam — production uses the global fetch.
  fetchImpl?: typeof fetch;
}

const RedeemBody = z.object({
  ticket: z.string().min(20).max(256),
});

const CallbackQuery = z.object({
  state: z.string().min(1).max(256),
  code: z.string().min(1).max(2048).optional(),
  error: z.string().max(128).optional(),
  error_description: z.string().max(512).optional(),
});

const PROVIDER = "google" as const;

export function googleOAuthPlugin(deps: GoogleOAuthDeps): FastifyPluginAsync {
  const redirectUri = `${deps.redirectBaseUrl.replace(/\/$/, "")}/oauth/google/callback`;

  return async function googleOAuthRoutes(app: FastifyInstance): Promise<void> {
    // Step 1 — initiate. Authenticated. Generates PKCE + state, persists to
    // oauth_states, and redirects the browser to Google.
    app.get(
      "/oauth/google/start",
      { preHandler: requireSession },
      async (req, reply) => {
        const user = req.sessionUser;
        if (!user) {
          reply.code(401).send({ error: "unauthorized" });
          return;
        }
        // Periodic best-effort cleanup so the table doesn't grow forever.
        await sweepExpiredOauthStates(app.pool).catch(() => {});

        const state = createOAuthState();
        const pkce = createPkcePair();
        await createOauthStateRow(app.pool, {
          state,
          userId: user.id,
          provider: PROVIDER,
          codeVerifier: pkce.verifier,
          ttlSec: deps.stateTtlSec,
        });

        const url = buildGoogleAuthUrl({
          clientId: deps.clientId,
          redirectUri,
          state,
          codeChallenge: pkce.challenge,
          loginHint: user.email,
        });
        reply.redirect(url);
      },
    );

    // Step 2 — callback. Public; the browser hits this directly from Google.
    // Validates state, exchanges code, upserts account, issues a one-shot
    // pickup ticket, and bounces the user to a tiny HTML page that opens
    // calmly://oauth/google/done?ticket=... in the desktop app.
    app.get<{ Querystring: z.infer<typeof CallbackQuery> }>(
      "/oauth/google/callback",
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
          // user denied / provider error
          return renderOAuthError({
            reply,
            code: q.error,
            description: q.error_description ?? null,
          });
        }
        if (!q.code) {
          return renderOAuthError({ reply, code: "missing_code", description: null });
        }

        const consumed = await consumeOauthState(app.pool, {
          state: q.state,
          provider: PROVIDER,
        });
        if (!consumed) {
          return renderOAuthError({ reply, code: "state_mismatch", description: null });
        }

        let exchange;
        try {
          exchange = await exchangeGoogleCode({
            clientId: deps.clientId,
            clientSecret: deps.clientSecret,
            redirectUri,
            code: q.code,
            codeVerifier: consumed.codeVerifier,
            fetchImpl: deps.fetchImpl,
          });
        } catch (err) {
          // We deliberately don't echo the provider's body — it can include
          // identifying material. Log a redacted hint server-side.
          req.log.warn(
            { status: err instanceof OAuthExchangeError ? err.status : null },
            "google token exchange failed",
          );
          return renderOAuthError({
            reply,
            code: "token_exchange_failed",
            description: null,
          });
        }

        let user;
        try {
          user = await fetchGoogleUserInfo({
            accessToken: exchange.accessToken,
            fetchImpl: deps.fetchImpl,
          });
        } catch (err) {
          req.log.warn(
            { status: err instanceof OAuthExchangeError ? err.status : null },
            "google userinfo failed",
          );
          return renderOAuthError({ reply, code: "userinfo_failed", description: null });
        }

        const account = await upsertCalendarAccount(app.pool, {
          userId: consumed.userId,
          provider: PROVIDER,
          externalAccountId: user.sub,
          email: user.email,
        });

        const issued = await issueOauthTicket({
          pool: app.pool,
          secret: deps.ticketSecret,
          userId: consumed.userId,
          accountId: account.id,
          provider: PROVIDER,
          refreshToken: exchange.refreshToken,
          accessToken: exchange.accessToken,
          expiresInSec: exchange.expiresInSec,
          ticketTtlSec: deps.ticketTtlSec,
        });

        renderOAuthSuccess({ reply, provider: PROVIDER, ticket: issued.ticket });
      },
    );

    // Step 3 — desktop redeem. Authenticated. Single-use; subsequent calls
    // for the same ticket fail with ticket_already_redeemed.
    app.post(
      "/oauth/google/redeem",
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
          provider: PROVIDER,
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
          provider: "google";
          external_account_id: string;
          email: string;
          status: "connected" | "disconnected" | "error";
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
  };
}
