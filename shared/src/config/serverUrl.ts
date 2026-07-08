export const DEFAULT_SERVER_URL = "https://sync.calmly.app";

export type ServerUrlValidation =
  | { ok: true; url: string }
  | {
      ok: false;
      error:
        | "empty"
        | "invalid_url"
        | "http_not_localhost"
        | "unsupported_protocol";
    };

/** Validates and normalises a candidate sync server URL. */
export function validateServerUrl(raw: string): ServerUrlValidation {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: "empty" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  if (parsed.protocol === "https:") {
    return { ok: true, url: trimmed.replace(/\/$/, "") };
  }

  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return { ok: true, url: trimmed.replace(/\/$/, "") };
    }
    return { ok: false, error: "http_not_localhost" };
  }

  return { ok: false, error: "unsupported_protocol" };
}

export const SERVER_URL_ERRORS: Record<
  Exclude<ServerUrlValidation, { ok: true }>["error"],
  string
> = {
  empty: "Enter a server URL.",
  invalid_url: "That doesn't look like a valid URL.",
  http_not_localhost: "Use HTTPS for non-localhost servers.",
  unsupported_protocol: "Only https:// (or http://localhost) is supported.",
};
