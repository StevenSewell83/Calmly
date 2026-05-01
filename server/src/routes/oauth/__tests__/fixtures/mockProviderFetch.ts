// CAL-08a — pluggable fetch double for OAuth integration tests. Used as the
// `oauthFetchImpl` on AppDeps so /oauth/<provider>/{callback,refresh} routes
// hit canned responses instead of accounts.google.com / login.microsoftonline.com.
//
// Designed to be re-used by CAL-08b (calmly-cyi) once sonnet's calendar import
// worker lands on opus's branch — at that point the same recorder will also
// stand in for googleapis.com/calendar/v3 / graph.microsoft.com calls.

import type { IncomingHttpHeaders } from "node:http";

export interface MockResponseSpec {
  status?: number;
  // One of `body` (JSON-serialized) or `bodyText` (passthrough). If both are
  // absent, an empty 200 is returned.
  body?: unknown;
  bodyText?: string;
  headers?: Record<string, string>;
}

export interface MockExpectation {
  urlPattern: RegExp;
  method?: string;
  response: MockResponseSpec;
}

export interface RecordedCall {
  url: string;
  method: string;
  bodyText: string | null;
  headers: IncomingHttpHeaders;
}

export interface MockProviderFetch {
  fetch: typeof fetch;
  // Register a canned response. URL is matched against `urlPattern`; if
  // `method` is omitted, all methods match.
  expect(spec: MockExpectation): void;
  calls(): RecordedCall[];
  reset(): void;
}

export function createMockProviderFetch(): MockProviderFetch {
  const expectations: MockExpectation[] = [];
  const recorded: RecordedCall[] = [];

  const fetchFn: typeof fetch = async (input, init) => {
    const url = extractUrl(input);
    const method = extractMethod(input, init).toUpperCase();
    const bodyText = await extractBodyText(input, init);
    const headers = extractHeaders(input, init);
    recorded.push({ url, method, bodyText, headers });

    const match = expectations.find(
      (e) =>
        e.urlPattern.test(url) &&
        (!e.method || e.method.toUpperCase() === method),
    );
    if (!match) {
      throw new Error(
        `mockProviderFetch: no expectation matched ${method} ${url}. ` +
          `Registered patterns: ${expectations
            .map((e) => `${e.method ?? "*"} ${e.urlPattern}`)
            .join(", ") || "(none)"}`,
      );
    }

    const status = match.response.status ?? 200;
    const responseBody =
      match.response.bodyText ??
      (match.response.body !== undefined
        ? JSON.stringify(match.response.body)
        : "");
    const responseHeaders: Record<string, string> = {
      "content-type": "application/json",
      ...(match.response.headers ?? {}),
    };
    return new Response(responseBody, {
      status,
      headers: responseHeaders,
    });
  };

  return {
    fetch: fetchFn,
    expect: (spec) => {
      expectations.push(spec);
    },
    calls: () => [...recorded],
    reset: () => {
      expectations.length = 0;
      recorded.length = 0;
    },
  };
}

function extractUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function extractMethod(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
): string {
  if (init?.method) return init.method;
  if (typeof input !== "string" && !(input instanceof URL)) return input.method;
  return "GET";
}

async function extractBodyText(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
): Promise<string | null> {
  const body = init?.body;
  if (body == null) {
    if (typeof input !== "string" && !(input instanceof URL)) {
      try {
        const cloned = input.clone();
        return await cloned.text();
      } catch {
        return null;
      }
    }
    return null;
  }
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    return [...body.entries()]
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : "[blob]"}`)
      .join("&");
  }
  return String(body);
}

function extractHeaders(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  const merge = (h: RequestInit["headers"] | undefined): void => {
    if (!h) return;
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        out[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(h)) {
      for (const pair of h as [string, string][]) {
        const [k, v] = pair;
        out[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(h as Record<string, string>)) {
        out[k.toLowerCase()] = v;
      }
    }
  };
  if (typeof input !== "string" && !(input instanceof URL)) {
    merge(input.headers);
  }
  merge(init?.headers);
  return out;
}
