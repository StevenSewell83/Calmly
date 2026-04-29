import type { ApiClient } from "../net/client";
import { ApiHttpError, ApiNetworkError } from "../net/client";

export interface AuthUser {
  id: string;
  email: string;
}

export type RequestLinkResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid_email" | "rate_limited" | "network" | "server";
    };

export type RedeemResult =
  | { ok: true; user: AuthUser; expiresAt: string }
  | {
      ok: false;
      error: "invalid_or_expired" | "invalid_request" | "network" | "server";
    };

export type StatusResult =
  | { signedIn: false }
  | { signedIn: true; user: AuthUser };

export interface AuthOrchestrator {
  requestLink(email: string): Promise<RequestLinkResult>;
  redeem(token: string): Promise<RedeemResult>;
  status(): Promise<StatusResult>;
  signOut(): Promise<{ ok: true }>;
}

// Loose enough to accept anything the server's stricter z.string().email() will
// also accept, but tight enough to reject obvious garbage before we round-trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isPlausibleEmail(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const trimmed = s.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed);
}

// Mirrors server-side isWellFormedToken: 32–128 base64url chars.
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
export function isWellFormedToken(s: unknown): s is string {
  return typeof s === "string" && TOKEN_RE.test(s);
}

export interface CreateAuthOrchestratorArgs {
  client: ApiClient;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

interface RedeemResponseBody {
  user: AuthUser;
  session: { expiresAt: string };
}

interface MeResponseBody {
  user: AuthUser;
}

export function createAuthOrchestrator(
  args: CreateAuthOrchestratorArgs,
): AuthOrchestrator {
  const log = args.log ?? (() => {});

  return {
    async requestLink(email) {
      if (!isPlausibleEmail(email)) {
        return { ok: false, error: "invalid_email" };
      }
      try {
        await args.client.request("POST", "/auth/magic-link/request", {
          email: email.trim(),
        });
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiHttpError) {
          if (e.status === 429) return { ok: false, error: "rate_limited" };
          if (e.status === 400) return { ok: false, error: "invalid_email" };
          return { ok: false, error: "server" };
        }
        if (e instanceof ApiNetworkError) {
          return { ok: false, error: "network" };
        }
        log("requestLink unknown error", { err: String(e) });
        return { ok: false, error: "server" };
      }
    },

    async redeem(token) {
      if (!isWellFormedToken(token)) {
        return { ok: false, error: "invalid_request" };
      }
      try {
        const r = await args.client.request<RedeemResponseBody>(
          "POST",
          "/auth/magic-link/redeem",
          { token },
        );
        return {
          ok: true,
          user: r.body.user,
          expiresAt: r.body.session.expiresAt,
        };
      } catch (e) {
        if (e instanceof ApiHttpError) {
          if (e.status === 410)
            return { ok: false, error: "invalid_or_expired" };
          if (e.status === 400) return { ok: false, error: "invalid_request" };
          return { ok: false, error: "server" };
        }
        if (e instanceof ApiNetworkError) {
          return { ok: false, error: "network" };
        }
        log("redeem unknown error", { err: String(e) });
        return { ok: false, error: "server" };
      }
    },

    async status() {
      try {
        const r = await args.client.request<MeResponseBody>("GET", "/auth/me");
        return { signedIn: true, user: r.body.user };
      } catch {
        // Any failure (401, network, etc.) is treated as signed-out — the
        // renderer just shows the sign-in screen and the user can retry.
        return { signedIn: false };
      }
    },

    async signOut() {
      try {
        await args.client.request("POST", "/auth/logout");
      } catch (e) {
        // Best-effort: server-side delete may have already occurred via cookie
        // expiry, or the network may be down. The renderer flips to signed-out
        // either way.
        log("signOut error (best effort)", { err: String(e) });
      }
      return { ok: true };
    },
  };
}
