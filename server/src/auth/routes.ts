import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { EmailAdapter } from "../email/adapter";
import { requireSession } from "../middleware/requireSession";
import { checkMagicLinkRateLimit } from "./rate-limit";
import {
  createSession,
  deleteSessionByToken,
  resolveSessionByToken,
} from "./session";
import { generateToken, hashToken, isWellFormedToken } from "./tokens";

const RequestBody = z.object({
  email: z.string().email().max(254),
});

const RedeemBody = z.object({
  token: z.string().refine(isWellFormedToken, {
    message: "malformed token",
  }),
});

interface UserRow {
  id: string;
  email: string;
}

function setSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  rawToken: string,
  expiresAt: Date,
  isProd: boolean,
): void {
  reply.setCookie(cookieName, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    expires: expiresAt,
  });
}

function clearSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  isProd: boolean,
): void {
  reply.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  });
}

export interface AuthRoutesDeps {
  email: EmailAdapter;
}

export function authRoutesPlugin(deps: AuthRoutesDeps) {
  return async function authRoutes(app: FastifyInstance): Promise<void> {
    const cfg = app.appConfig;
    const isProd = cfg.NODE_ENV === "production";
    const cookieName = cfg.COOKIE_NAME;

    app.post("/auth/magic-link/request", async (req, reply) => {
      const parsed = RequestBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_request" });
        return;
      }
      const email = parsed.data.email.toLowerCase().trim();
      const ip = req.ip;

      // Upsert the user — we want a stable user_id even on first contact so
      // that rate-limiting + token storage have something to point to.
      const userR = await app.pool.query<UserRow>(
        `INSERT INTO users (email)
              VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id, email`,
        [email],
      );
      const user = userR.rows[0];
      if (!user) {
        // Should not happen — RETURNING fires on UPDATE too — but keep the
        // anti-enumeration shape in case of a corner case.
        return { ok: true };
      }

      const limit = await checkMagicLinkRateLimit(app.pool, {
        userId: user.id,
        ip,
      });
      if (!limit.allowed) {
        reply.code(429).send({ error: "rate_limited", reason: limit.reason });
        return;
      }

      const rawToken = generateToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + cfg.MAGIC_LINK_TTL_MIN * 60_000);

      await app.pool.query(
        `INSERT INTO magic_link_tokens
           (token_hash, user_id, expires_at, requested_ip)
         VALUES ($1, $2, $3, $4)`,
        [tokenHash, user.id, expiresAt, ip],
      );

      const link = `${cfg.APP_URL}/auth/magic-link/redeem?token=${encodeURIComponent(rawToken)}`;
      try {
        await deps.email.sendMagicLink({ to: user.email, link, expiresAt });
      } catch (err) {
        req.log.error({ err }, "magic link email send failed");
      }

      // Always 200 to defeat enumeration. The body shape never reveals
      // whether the email already had an account.
      return { ok: true };
    });

    app.post("/auth/magic-link/redeem", async (req, reply) => {
      const parsed = RedeemBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_request" });
        return;
      }
      const tokenHash = hashToken(parsed.data.token);

      // Atomic consume: only consume rows that haven't been consumed AND
      // haven't expired. The RETURNING gives us the user_id in one round-trip.
      const r = await app.pool.query<{ user_id: string; email: string }>(
        `WITH consumed AS (
           UPDATE magic_link_tokens
              SET consumed_at = now()
            WHERE token_hash = $1
              AND consumed_at IS NULL
              AND expires_at > now()
            RETURNING user_id
         )
         SELECT consumed.user_id, users.email
           FROM consumed
           JOIN users ON users.id = consumed.user_id`,
        [tokenHash],
      );
      const row = r.rows[0];
      if (!row) {
        reply.code(410).send({ error: "token_invalid_or_expired" });
        return;
      }

      const session = await createSession(app.pool, {
        userId: row.user_id,
        ttlMs: cfg.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
        userAgent: req.headers["user-agent"] ?? null,
      });

      setSessionCookie(
        reply,
        cookieName,
        session.rawToken,
        session.expiresAt,
        isProd,
      );
      return {
        user: { id: row.user_id, email: row.email },
        session: { expiresAt: session.expiresAt.toISOString() },
      };
    });

    app.post("/auth/logout", async (req, reply) => {
      const raw = req.cookies?.[cookieName];
      if (raw && isWellFormedToken(raw)) {
        await deleteSessionByToken(app.pool, raw);
      }
      clearSessionCookie(reply, cookieName, isProd);
      return { ok: true };
    });

    app.get("/auth/me", { preHandler: requireSession }, async (req) => {
      return { user: req.sessionUser };
    });

    // Convenience GET for redeem so the email link works as an Electron deep
    // link without forcing a POST. Clients that call this from JS should
    // prefer POST so credentials/cookie semantics are unambiguous.
    app.get<{ Querystring: { token?: string } }>(
      "/auth/magic-link/redeem",
      async (req, reply) => {
        const raw = req.query?.token;
        if (typeof raw !== "string" || !isWellFormedToken(raw)) {
          reply.code(400).send({ error: "invalid_request" });
          return;
        }
        const tokenHash = hashToken(raw);
        const r = await app.pool.query<{ user_id: string; email: string }>(
          `WITH consumed AS (
             UPDATE magic_link_tokens
                SET consumed_at = now()
              WHERE token_hash = $1
                AND consumed_at IS NULL
                AND expires_at > now()
              RETURNING user_id
           )
           SELECT consumed.user_id, users.email
             FROM consumed
             JOIN users ON users.id = consumed.user_id`,
          [tokenHash],
        );
        const row = r.rows[0];
        if (!row) {
          reply.code(410).send({ error: "token_invalid_or_expired" });
          return;
        }
        const session = await createSession(app.pool, {
          userId: row.user_id,
          ttlMs: cfg.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
          userAgent: req.headers["user-agent"] ?? null,
        });
        setSessionCookie(
          reply,
          cookieName,
          session.rawToken,
          session.expiresAt,
          isProd,
        );
        return {
          user: { id: row.user_id, email: row.email },
          session: { expiresAt: session.expiresAt.toISOString() },
        };
      },
    );

    // Resolve helper exposed for tests + future client-facing /auth/check.
    app.decorate("resolveSession", async (rawToken: string) =>
      resolveSessionByToken(app.pool, rawToken),
    );
  };
}

declare module "fastify" {
  interface FastifyInstance {
    resolveSession(
      rawToken: string,
    ): Promise<Awaited<ReturnType<typeof resolveSessionByToken>>>;
  }
}
