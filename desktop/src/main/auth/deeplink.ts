// Pure parsing helpers for the calmly:// custom protocol. No Electron import
// here so the unit tests can load the module under vitest's node environment.
// Electron-coupled wiring (installDeepLink, single-instance lock) lives in
// ./deeplink-install.ts.

export const PROTOCOL = "calmly";

const DEEPLINK_HOST = "auth";
const DEEPLINK_PATH = "/callback";

export interface DeepLinkPayload {
  token: string;
}

// Strict parse of calmly://auth/callback?token=...  Anything else returns
// null so the caller can ignore stray invocations without throwing.
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
  if (parsed.host !== DEEPLINK_HOST) return null;
  const path = parsed.pathname.replace(/\/$/, "");
  if (path !== DEEPLINK_PATH) return null;

  const token = parsed.searchParams.get("token");
  if (!token) return null;
  return { token };
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
