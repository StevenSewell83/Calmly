// Pure parsing helpers for the calmly:// custom protocol. No Electron import
// here so the unit tests can load the module under vitest's node environment.
// Electron-coupled wiring (installDeepLink, single-instance lock) lives in
// ./deeplink-install.ts.

export const PROTOCOL = "calmly";

const AUTH_HOST = "auth";
const AUTH_PATH = "/callback";

const OAUTH_HOST = "oauth";
// "done" here is a URL path segment (calmly://oauth/<provider>/done) —
// unrelated to TaskStatus. The eslint-disable below is intentional.
// eslint-disable-next-line no-restricted-syntax
const OAUTH_DONE_ACTION = "done";
const OAUTH_PROVIDERS = ["google", "microsoft"] as const;
type OAuthProviderHost = (typeof OAUTH_PROVIDERS)[number];

export type DeepLinkPayload =
  | { kind: "auth"; token: string }
  | {
      kind: "calendar-oauth";
      provider: OAuthProviderHost;
      ticket: string;
    };

// Strict parse of:
//   calmly://auth/callback?token=...
//   calmly://oauth/<provider>/done?ticket=...
// Anything else returns null so the caller can ignore stray invocations
// without throwing.
export function parseDeepLink(rawUrl: unknown): DeepLinkPayload | null {
  if (typeof rawUrl !== "string") return null;
  if (!rawUrl.toLowerCase().startsWith(`${PROTOCOL}://`)) return null;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PROTOCOL}:`) return null;

  if (parsed.host === AUTH_HOST) {
    const path = parsed.pathname.replace(/\/$/, "");
    if (path !== AUTH_PATH) return null;
    const token = parsed.searchParams.get("token");
    if (!token) return null;
    return { kind: "auth", token };
  }

  if (parsed.host === OAUTH_HOST) {
    // Path is `/<provider>/done` — split, drop empty leading segment.
    const segs = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segs.length !== 2) return null;
    const [provider, action] = segs as [string, string];
    if (!isOAuthProvider(provider)) return null;
    if (action !== OAUTH_DONE_ACTION) return null;
    const ticket = parsed.searchParams.get("ticket");
    if (!ticket) return null;
    return { kind: "calendar-oauth", provider, ticket };
  }

  return null;
}

function isOAuthProvider(s: string): s is OAuthProviderHost {
  return (OAUTH_PROVIDERS as readonly string[]).includes(s);
}

// On Windows/Linux a deep-link launch passes the URL as one of the argv
// entries. The position varies by OS + packaging mode, so scan all of them.
export function findDeepLinkInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (
      typeof arg === "string" &&
      arg.toLowerCase().startsWith(`${PROTOCOL}://`)
    ) {
      return arg;
    }
  }
  return null;
}
