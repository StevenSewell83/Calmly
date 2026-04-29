import { backoffDelayMs } from "../sync/backoff";

// Thrown when the server returns a non-2xx HTTP response. Both the status and
// the parsed body (if JSON) are surfaced so callers can map specific server
// error shapes to their own typed result codes.
export class ApiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }
}

// Thrown when the request never reached an HTTP response (DNS, connection
// refused, timeout, etc.) and we have already exhausted retries.
export class ApiNetworkError extends Error {
  readonly originalError: unknown;
  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = "ApiNetworkError";
    this.originalError = originalError;
  }
}

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface ApiClient {
  request<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>>;
}

export interface CreateApiClientArgs {
  baseUrl: string;
  // Production wires this to session.defaultSession.fetch.bind(session) so the
  // Electron cookie jar is populated automatically from Set-Cookie. Tests pass
  // a vi.fn() returning canned responses.
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  // Number of additional attempts after the first failure. Default 2 (3 total).
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 2;

export function createApiClient(args: CreateApiClientArgs): ApiClient {
  const fetchFn = args.fetchImpl ?? fetch;
  const sleep =
    args.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = args.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseUrl = args.baseUrl.replace(/\/$/, "");

  return {
    async request<T>(
      method: HttpMethod,
      path: string,
      body?: unknown,
    ): Promise<ApiResponse<T>> {
      const url = `${baseUrl}${path}`;
      const init: RequestInit = {
        method,
        // credentials:"include" is a no-op for session.fetch (main process
        // doesn't gate cookies on this) but matters if a test injects standard
        // fetch in a same-process scenario.
        credentials: "include",
        headers:
          body !== undefined
            ? { "content-type": "application/json" }
            : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      };

      let attempt = 0;
      // Loop runs up to (1 + maxRetries) times; each retry sleeps backoff(attempt-1).
      for (;;) {
        let res: Response;
        try {
          res = await fetchFn(url, init);
        } catch (e) {
          if (attempt < maxRetries) {
            await sleep(backoffDelayMs(attempt));
            attempt++;
            continue;
          }
          throw new ApiNetworkError(
            `network error calling ${method} ${path}: ${
              e instanceof Error ? e.message : String(e)
            }`,
            e,
          );
        }

        if (res.status >= 500 && res.status < 600 && attempt < maxRetries) {
          await sleep(backoffDelayMs(attempt));
          attempt++;
          continue;
        }

        const parsed = await readResponseBody(res);

        if (!res.ok) {
          throw new ApiHttpError(
            `${method} ${path} failed: ${res.status}`,
            res.status,
            parsed,
          );
        }

        return { status: res.status, body: parsed as T };
      }
    },
  };
}

async function readResponseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}
