import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { OAuthRefreshError, type RefreshResult } from "../../oauth/refresh";
import { requireSession } from "../../middleware/requireSession";
import type { OAuthRoutesDeps } from "./types";

const RefreshBody = z.object({
  account_id: z.string().uuid(),
  refresh_token: z.string().min(1).max(4096),
});

const DisconnectBody = z.object({
  account_id: z.string().uuid(),
});

// Registers /refresh and /disconnect for one provider. The connect-flow
// routes (start, callback, redeem) live in connectRoutes.ts.
export function registerManageRoutes(
  app: FastifyInstance,
  deps: OAuthRoutesDeps,
): void {
  const { config } = deps;
  const provider = config.provider;

  app.post(
    `/oauth/${provider}/disconnect`,
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser;
      if (!user) {
        reply.code(401).send({ ok: false, error: "unauthorized" });
        return;
      }
      const parsed = DisconnectBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ ok: false, error: "invalid_request" });
        return;
      }
      // Idempotent: deleting an already-deleted row is fine. Scoped by
      // user_id + provider so a session for one user cannot disconnect
      // another user's account.
      const r = await app.pool.query<{ id: string }>(
        `DELETE FROM calendar_accounts
           WHERE id = $1 AND user_id = $2 AND provider = $3
         RETURNING id`,
        [parsed.data.account_id, user.id, provider],
      );
      return { ok: true as const, deleted: r.rows.length > 0 };
    },
  );

  app.post(
    `/oauth/${provider}/refresh`,
    { preHandler: requireSession },
    async (req, reply) => {
      const user = req.sessionUser;
      if (!user) {
        reply.code(401).send({ ok: false, error: "unauthorized" });
        return;
      }
      const parsed = RefreshBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ ok: false, error: "invalid_request" });
        return;
      }

      // The desktop client owns the refresh token (F-12), but we still
      // verify the account_id belongs to the authed user — defense in
      // depth against a stolen session being used to mint tokens for a
      // different user's calendar.
      const ownership = await app.pool.query<{ id: string }>(
        `SELECT id FROM calendar_accounts
           WHERE id = $1 AND user_id = $2 AND provider = $3`,
        [parsed.data.account_id, user.id, provider],
      );
      if (!ownership.rows[0]) {
        reply.code(404).send({ ok: false, error: "account_not_found" });
        return;
      }

      let result: RefreshResult;
      try {
        result = await config.refreshAccessToken({
          clientId: deps.clientId,
          clientSecret: deps.clientSecret,
          refreshToken: parsed.data.refresh_token,
          fetchImpl: deps.fetchImpl,
        });
      } catch (err) {
        if (err instanceof OAuthRefreshError) {
          // Don't echo the provider's body — it can include identifiers.
          req.log.warn(
            { provider, code: err.code, status: err.status },
            "oauth refresh failed",
          );
          // invalid_grant gets a stable HTTP status the desktop can
          // distinguish from transient failures.
          const httpCode = err.code === "invalid_grant" ? 410 : 502;
          reply.code(httpCode).send({ ok: false, error: err.code });
          return;
        }
        req.log.error({ provider, err: String(err) }, "oauth refresh threw");
        reply.code(500).send({ ok: false, error: "internal_error" });
        return;
      }

      return {
        ok: true as const,
        access_token: result.accessToken,
        expires_in: result.expiresInSec,
        // null when the provider chose not to rotate; the client preserves
        // its existing refresh token in that case.
        refresh_token: result.refreshToken,
      };
    },
  );
}
