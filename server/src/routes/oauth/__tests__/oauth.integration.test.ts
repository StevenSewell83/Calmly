// CAL-08a — OAuth route integration test pass.
//
// Stands up a real Postgres via testcontainers + the full Fastify app via
// buildApp(), but pipes a stub `fetch` into the OAuth plugins so calls to
// accounts.google.com / login.microsoftonline.com / graph.microsoft.com hit
// canned responses. Validates the server's contract end-to-end:
//   - /oauth/<p>/start  → redirect URL shape, oauth_states row written
//   - /oauth/<p>/callback → token exchange + userinfo fetch + calendar_account
//     upsert + ticket issuance + success HTML
//   - /oauth/<p>/redeem → ticket validates, returns refresh+access tokens
//   - /oauth/<p>/refresh → success / invalid_grant→410 / 5xx→502
//   - /oauth/<p>/disconnect → row deleted
//   - negative paths: state mismatch, token-exchange failure, ticket replay
//
// Skips when Docker isn't available (mirrors magic-link.integration.test.ts).
// CAL-08b (calmly-cyi) reuses createMockProviderFetch for event-import specs.

import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { runner as runMigrations } from "node-pg-migrate";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../app";
import { loadConfig } from "../../../config";
import { generateToken, hashToken } from "../../../auth/tokens";
import {
  createMockProviderFetch,
  type MockProviderFetch,
} from "./fixtures/mockProviderFetch";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, "../../../../migrations");

async function detectDockerRuntime(): Promise<boolean> {
  try {
    const mod = (await import(
      "testcontainers/build/container-runtime/clients/client.js"
    )) as unknown as { getContainerRuntimeClient: () => Promise<unknown> };
    const { getContainerRuntimeClient } = mod;
    await getContainerRuntimeClient();
    return true;
  } catch {
    return false;
  }
}

const dockerAvailable = await detectDockerRuntime();

describe.skipIf(!dockerAvailable)(
  "oauth — DB integration",
  () => {
    let pool: pg.Pool;
    let stopContainer: () => Promise<void>;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let mock: MockProviderFetch;

    const GOOGLE_TOKEN_URL = /^https:\/\/oauth2\.googleapis\.com\/token/;
    const GOOGLE_USERINFO_URL =
      /^https:\/\/openidconnect\.googleapis\.com\/v1\/userinfo/;
    const MS_TOKEN_URL =
      /^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/token/;
    const MS_GRAPH_ME_URL = /^https:\/\/graph\.microsoft\.com\/v1\.0\/me/;

    beforeAll(async () => {
      const container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("calmly_test")
        .withUsername("calmly_test")
        .withPassword("calmly_test")
        .start();

      const connectionString = container.getConnectionUri();
      stopContainer = () => container.stop().then(() => {});

      await runMigrations({
        databaseUrl: connectionString,
        migrationsTable: "pgmigrations",
        dir: MIGRATIONS_DIR,
        direction: "up",
        log: () => {},
      });

      pool = new pg.Pool({ connectionString });
      mock = createMockProviderFetch();

      const config = loadConfig({
        NODE_ENV: "test",
        DATABASE_URL: connectionString,
        COOKIE_SECRET: "test-cookie-secret-for-vitest-32chars",
        MAGIC_LINK_TTL_MIN: "15",
        SESSION_TTL_DAYS: "30",
        APP_URL: "http://localhost:3001",
        GOOGLE_CLIENT_ID: "g-client",
        GOOGLE_CLIENT_SECRET: "g-secret-32-chars-or-whatever-min",
        MICROSOFT_CLIENT_ID: "ms-client",
        MICROSOFT_CLIENT_SECRET: "ms-secret-32-chars-or-whatever-mn",
        OAUTH_TICKET_SECRET: "oauth-ticket-secret-32chars-pad-",
      });

      app = await buildApp({ config, pool, oauthFetchImpl: mock.fetch });
      await app.ready();
    });

    afterAll(async () => {
      await app?.close();
      await pool?.end();
      await stopContainer?.();
    });

    beforeEach(() => {
      mock.reset();
    });

    async function ensureUser(email: string): Promise<string> {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO users (email) VALUES ($1)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [email],
      );
      return r.rows[0]!.id;
    }

    // Sign-in helper: insert a fresh magic-link token and redeem it. Returns
    // the session cookie pair (full Set-Cookie value + the name=value piece
    // we attach to subsequent request headers).
    async function signInAs(
      email: string,
    ): Promise<{ userId: string; cookie: string }> {
      const userId = await ensureUser(email);
      const rawToken = generateToken();
      await pool.query(
        `INSERT INTO magic_link_tokens (token_hash, user_id, expires_at, requested_ip)
         VALUES ($1, $2, $3, $4)`,
        [
          hashToken(rawToken),
          userId,
          new Date(Date.now() + 15 * 60_000),
          "127.0.0.1",
        ],
      );
      const redeem = await app.inject({
        method: "POST",
        url: "/auth/magic-link/redeem",
        payload: { token: rawToken },
      });
      expect(redeem.statusCode).toBe(200);
      const setCookie = redeem.headers["set-cookie"];
      const fullSetCookie = Array.isArray(setCookie)
        ? (setCookie[0] ?? "")
        : (setCookie ?? "");
      const cookie = fullSetCookie.split(";")[0] ?? "";
      expect(cookie).toMatch(/^calmly_session=/);
      return { userId, cookie };
    }

    async function startProvider(
      provider: "google" | "microsoft",
      cookie: string,
    ): Promise<{ state: string; codeChallenge: string }> {
      const res = await app.inject({
        method: "GET",
        url: `/oauth/${provider}/start`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(302);
      const location = res.headers.location as string;
      const u = new URL(location);
      const state = u.searchParams.get("state");
      const challenge = u.searchParams.get("code_challenge");
      expect(state).toBeTruthy();
      expect(challenge).toBeTruthy();
      return { state: state!, codeChallenge: challenge! };
    }

    function ticketFromCallbackHtml(html: string): string {
      const match = html.match(/calmly:\/\/oauth\/[^/]+\/done\?ticket=([^"&\s]+)/);
      expect(match, "callback HTML missing ticket deep-link").toBeTruthy();
      return decodeURIComponent(match![1]!);
    }

    describe("Google OAuth happy path (CAL-08 spec 1)", () => {
      it("start → callback → redeem creates account and returns tokens", async () => {
        const { userId, cookie } = await signInAs("alex@example.com");

        // /start: shape of the redirect URL.
        const startRes = await app.inject({
          method: "GET",
          url: "/oauth/google/start",
          headers: { cookie },
        });
        expect(startRes.statusCode).toBe(302);
        const auth = new URL(startRes.headers.location as string);
        expect(auth.origin + auth.pathname).toBe(
          "https://accounts.google.com/o/oauth2/v2/auth",
        );
        expect(auth.searchParams.get("response_type")).toBe("code");
        expect(auth.searchParams.get("client_id")).toBe("g-client");
        expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
        expect(auth.searchParams.get("access_type")).toBe("offline");
        expect(auth.searchParams.get("prompt")).toBe("consent");
        expect(auth.searchParams.get("login_hint")).toBe("alex@example.com");
        const state = auth.searchParams.get("state")!;

        // oauth_states row exists.
        const stateRow = await pool.query<{ user_id: string }>(
          "SELECT user_id FROM oauth_states WHERE state = $1",
          [state],
        );
        expect(stateRow.rows).toHaveLength(1);

        // /callback: stub the token + userinfo responses.
        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "g-access-1",
              refresh_token: "g-refresh-1",
              expires_in: 3600,
              scope: "openid email profile",
              id_token: "g-id-token",
            },
          },
        });
        mock.expect({
          urlPattern: GOOGLE_USERINFO_URL,
          method: "GET",
          response: {
            body: {
              sub: "g-user-12345",
              email: "alex@example.com",
              email_verified: true,
            },
          },
        });

        const cbRes = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=fake-auth-code`,
        });
        expect(cbRes.statusCode).toBe(200);
        expect(cbRes.headers["content-type"]).toMatch(/text\/html/);
        const ticket = ticketFromCallbackHtml(cbRes.body);
        expect(ticket).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);

        // /callback consumed the state row.
        const stateAfter = await pool.query(
          "SELECT 1 FROM oauth_states WHERE state = $1",
          [state],
        );
        expect(stateAfter.rows).toHaveLength(0);

        // calendar_accounts row created with the userinfo data.
        const acct = await pool.query<{
          id: string;
          provider: string;
          external_account_id: string;
          email: string;
          status: string;
        }>(
          `SELECT id, provider, external_account_id, email, status
             FROM calendar_accounts WHERE user_id = $1 AND provider = 'google'`,
          [userId],
        );
        expect(acct.rows).toHaveLength(1);
        expect(acct.rows[0]!.external_account_id).toBe("g-user-12345");
        expect(acct.rows[0]!.email).toBe("alex@example.com");
        expect(acct.rows[0]!.status).toBe("connected");

        // oauth_tickets row exists.
        const tickets = await pool.query<{ jti: string }>(
          "SELECT jti FROM oauth_tickets WHERE user_id = $1",
          [userId],
        );
        expect(tickets.rows).toHaveLength(1);

        // /redeem: hand back the tokens.
        const redeemRes = await app.inject({
          method: "POST",
          url: "/oauth/google/redeem",
          headers: { cookie },
          payload: { ticket },
        });
        expect(redeemRes.statusCode).toBe(200);
        const body = redeemRes.json() as {
          ok: boolean;
          account: { provider: string; status: string; email: string };
          refresh_token: string;
          access_token: string;
          expires_in: number;
        };
        expect(body.ok).toBe(true);
        expect(body.account.provider).toBe("google");
        expect(body.account.status).toBe("connected");
        expect(body.account.email).toBe("alex@example.com");
        expect(body.refresh_token).toBe("g-refresh-1");
        expect(body.access_token).toBe("g-access-1");
        expect(body.expires_in).toBe(3600);

        // Ticket consumed.
        const ticketAfter = await pool.query(
          "SELECT 1 FROM oauth_tickets WHERE user_id = $1",
          [userId],
        );
        expect(ticketAfter.rows).toHaveLength(0);

        // Verify token-exchange request shape.
        const tokenCall = mock
          .calls()
          .find((c) => /oauth2\.googleapis\.com\/token/.test(c.url));
        expect(tokenCall).toBeTruthy();
        expect(tokenCall!.method).toBe("POST");
        expect(tokenCall!.bodyText).toContain("grant_type=authorization_code");
        expect(tokenCall!.bodyText).toContain("code=fake-auth-code");
        expect(tokenCall!.bodyText).toContain("code_verifier=");
      });
    });

    describe("Microsoft OAuth happy path (CAL-08 spec 2)", () => {
      it("start → callback → redeem creates account and returns tokens", async () => {
        const { userId, cookie } = await signInAs("ms@example.com");
        const { state } = await startProvider("microsoft", cookie);

        mock.expect({
          urlPattern: MS_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "ms-access-1",
              refresh_token: "ms-refresh-1",
              expires_in: 3600,
              scope: "Calendars.Read User.Read offline_access",
              id_token: "ms-id-token",
              token_type: "Bearer",
            },
          },
        });
        mock.expect({
          urlPattern: MS_GRAPH_ME_URL,
          method: "GET",
          response: {
            body: {
              id: "ms-user-99",
              userPrincipalName: "ms@example.com",
              mail: "ms@example.com",
            },
          },
        });

        const cbRes = await app.inject({
          method: "GET",
          url: `/oauth/microsoft/callback?state=${encodeURIComponent(state)}&code=ms-code`,
        });
        expect(cbRes.statusCode).toBe(200);
        const ticket = ticketFromCallbackHtml(cbRes.body);

        const acct = await pool.query<{ external_account_id: string; status: string }>(
          `SELECT external_account_id, status FROM calendar_accounts
             WHERE user_id = $1 AND provider = 'microsoft'`,
          [userId],
        );
        expect(acct.rows).toHaveLength(1);
        expect(acct.rows[0]!.external_account_id).toBe("ms-user-99");
        expect(acct.rows[0]!.status).toBe("connected");

        const redeemRes = await app.inject({
          method: "POST",
          url: "/oauth/microsoft/redeem",
          headers: { cookie },
          payload: { ticket },
        });
        expect(redeemRes.statusCode).toBe(200);
        const body = redeemRes.json() as {
          ok: boolean;
          refresh_token: string;
          access_token: string;
        };
        expect(body.ok).toBe(true);
        expect(body.refresh_token).toBe("ms-refresh-1");
        expect(body.access_token).toBe("ms-access-1");
      });
    });

    describe("Refresh-token grant (CAL-08 spec 3)", () => {
      async function seedAccount(
        userId: string,
        provider: "google" | "microsoft",
      ): Promise<string> {
        const r = await pool.query<{ id: string }>(
          `INSERT INTO calendar_accounts
             (user_id, provider, external_account_id, email, status)
           VALUES ($1, $2, $3, $4, 'connected')
           RETURNING id`,
          [userId, provider, `${provider}-extid-refresh`, `r-${Date.now()}@e.com`],
        );
        return r.rows[0]!.id;
      }

      it("success: returns a fresh access_token; rotated refresh_token preserved", async () => {
        const { userId, cookie } = await signInAs("refresh-ok@example.com");
        const accountId = await seedAccount(userId, "google");

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "g-access-2",
              expires_in: 1800,
              scope: "openid email profile",
            },
          },
        });

        const res = await app.inject({
          method: "POST",
          url: "/oauth/google/refresh",
          headers: { cookie },
          payload: { account_id: accountId, refresh_token: "g-refresh-1" },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json() as {
          ok: boolean;
          access_token: string;
          expires_in: number;
          refresh_token: string | null;
        };
        expect(body.ok).toBe(true);
        expect(body.access_token).toBe("g-access-2");
        expect(body.expires_in).toBe(1800);
        // Google does not rotate by default → server returns null so the
        // client preserves its existing refresh token.
        expect(body.refresh_token).toBeNull();
      });

      it("invalid_grant from provider → 410 with code 'invalid_grant'", async () => {
        const { userId, cookie } = await signInAs("refresh-revoked@example.com");
        const accountId = await seedAccount(userId, "google");

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            status: 400,
            body: {
              error: "invalid_grant",
              error_description: "Token has been expired or revoked.",
            },
          },
        });

        const res = await app.inject({
          method: "POST",
          url: "/oauth/google/refresh",
          headers: { cookie },
          payload: { account_id: accountId, refresh_token: "stale" },
        });
        expect(res.statusCode).toBe(410);
        expect(res.json()).toMatchObject({ ok: false, error: "invalid_grant" });
      });

      it("provider 5xx → 502 with code 'provider_error'", async () => {
        const { userId, cookie } = await signInAs("refresh-5xx@example.com");
        const accountId = await seedAccount(userId, "google");

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: { status: 503, body: { error: "service_unavailable" } },
        });

        const res = await app.inject({
          method: "POST",
          url: "/oauth/google/refresh",
          headers: { cookie },
          payload: { account_id: accountId, refresh_token: "valid" },
        });
        expect(res.statusCode).toBe(502);
        expect(res.json()).toMatchObject({ ok: false, error: "provider_error" });
      });

      it("refresh against a different user's account → 404", async () => {
        const owner = await signInAs("refresh-owner@example.com");
        const accountId = await seedAccount(owner.userId, "google");

        const intruder = await signInAs("refresh-intruder@example.com");
        const res = await app.inject({
          method: "POST",
          url: "/oauth/google/refresh",
          headers: { cookie: intruder.cookie },
          payload: { account_id: accountId, refresh_token: "anything" },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toMatchObject({ ok: false, error: "account_not_found" });
      });
    });

    describe("Negative paths", () => {
      it("callback with unknown state → state_mismatch", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/oauth/google/callback?state=never-issued&code=any",
        });
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain("state_mismatch");
      });

      it("callback with replayed (already consumed) state → state_mismatch", async () => {
        const { cookie } = await signInAs("replay@example.com");
        const { state } = await startProvider("google", cookie);

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "ok",
              refresh_token: "ok",
              expires_in: 60,
              scope: "openid",
            },
          },
        });
        mock.expect({
          urlPattern: GOOGLE_USERINFO_URL,
          method: "GET",
          response: {
            body: {
              sub: "g-replay",
              email: "replay@example.com",
              email_verified: true,
            },
          },
        });

        const first = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`,
        });
        expect(first.statusCode).toBe(200);

        const replay = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`,
        });
        expect(replay.statusCode).toBe(400);
        expect(replay.body).toContain("state_mismatch");
      });

      it("provider returns 400 on token exchange → token_exchange_failed", async () => {
        const { cookie } = await signInAs("badcode@example.com");
        const { state } = await startProvider("google", cookie);

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            status: 400,
            body: {
              error: "invalid_grant",
              error_description: "bad code",
            },
          },
        });

        const res = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=bad`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain("token_exchange_failed");
      });

      it("userinfo endpoint failure after token exchange → userinfo_failed", async () => {
        const { cookie } = await signInAs("uinfo-fail@example.com");
        const { state } = await startProvider("google", cookie);

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "a",
              refresh_token: "r",
              expires_in: 60,
              scope: "openid",
            },
          },
        });
        mock.expect({
          urlPattern: GOOGLE_USERINFO_URL,
          method: "GET",
          response: { status: 500, body: { error: "boom" } },
        });

        const res = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`,
        });
        expect(res.statusCode).toBe(400);
        expect(res.body).toContain("userinfo_failed");
      });

      it("redeem with mismatched session → 410 ticket_user_mismatch", async () => {
        const owner = await signInAs("ticket-owner@example.com");
        const { state } = await startProvider("google", owner.cookie);

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "a",
              refresh_token: "r",
              expires_in: 60,
              scope: "openid",
            },
          },
        });
        mock.expect({
          urlPattern: GOOGLE_USERINFO_URL,
          method: "GET",
          response: {
            body: {
              sub: "g-ticket-mismatch",
              email: "ticket-owner@example.com",
              email_verified: true,
            },
          },
        });
        const cb = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`,
        });
        const ticket = ticketFromCallbackHtml(cb.body);

        const intruder = await signInAs("ticket-intruder@example.com");
        const redeem = await app.inject({
          method: "POST",
          url: "/oauth/google/redeem",
          headers: { cookie: intruder.cookie },
          payload: { ticket },
        });
        expect(redeem.statusCode).toBe(410);
        expect(redeem.json()).toMatchObject({
          ok: false,
          error: "ticket_user_mismatch",
        });
      });

      it("redeem twice → second call is 410 (ticket already redeemed)", async () => {
        const { cookie } = await signInAs("redeem-twice@example.com");
        const { state } = await startProvider("google", cookie);

        mock.expect({
          urlPattern: GOOGLE_TOKEN_URL,
          method: "POST",
          response: {
            body: {
              access_token: "a",
              refresh_token: "r",
              expires_in: 60,
              scope: "openid",
            },
          },
        });
        mock.expect({
          urlPattern: GOOGLE_USERINFO_URL,
          method: "GET",
          response: {
            body: {
              sub: "g-redeem-twice",
              email: "redeem-twice@example.com",
              email_verified: true,
            },
          },
        });
        const cb = await app.inject({
          method: "GET",
          url: `/oauth/google/callback?state=${encodeURIComponent(state)}&code=c`,
        });
        const ticket = ticketFromCallbackHtml(cb.body);

        const first = await app.inject({
          method: "POST",
          url: "/oauth/google/redeem",
          headers: { cookie },
          payload: { ticket },
        });
        expect(first.statusCode).toBe(200);

        const second = await app.inject({
          method: "POST",
          url: "/oauth/google/redeem",
          headers: { cookie },
          payload: { ticket },
        });
        expect(second.statusCode).toBe(410);
      });
    });

    describe("Disconnect", () => {
      it("removes the calendar_accounts row scoped to the session user", async () => {
        const { userId, cookie } = await signInAs("disc@example.com");
        const r = await pool.query<{ id: string }>(
          `INSERT INTO calendar_accounts
             (user_id, provider, external_account_id, email, status)
           VALUES ($1, 'google', 'disc-ext', 'disc@example.com', 'connected')
           RETURNING id`,
          [userId],
        );
        const accountId = r.rows[0]!.id;

        const res = await app.inject({
          method: "POST",
          url: "/oauth/google/disconnect",
          headers: { cookie },
          payload: { account_id: accountId },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ ok: true, deleted: true });

        const after = await pool.query(
          "SELECT 1 FROM calendar_accounts WHERE id = $1",
          [accountId],
        );
        expect(after.rows).toHaveLength(0);
      });

      it("disconnect from another user's session is a no-op (deleted: false)", async () => {
        const owner = await signInAs("disc-owner@example.com");
        const r = await pool.query<{ id: string }>(
          `INSERT INTO calendar_accounts
             (user_id, provider, external_account_id, email, status)
           VALUES ($1, 'google', 'disc-owner-ext', 'disc-owner@example.com', 'connected')
           RETURNING id`,
          [owner.userId],
        );
        const accountId = r.rows[0]!.id;

        const intruder = await signInAs("disc-intruder@example.com");
        const res = await app.inject({
          method: "POST",
          url: "/oauth/google/disconnect",
          headers: { cookie: intruder.cookie },
          payload: { account_id: accountId },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ ok: true, deleted: false });

        const after = await pool.query(
          "SELECT 1 FROM calendar_accounts WHERE id = $1",
          [accountId],
        );
        expect(after.rows).toHaveLength(1);
      });
    });
  },
  { timeout: 180_000 },
);
