import type {
  PullResponse,
  PushRequest,
  PushResponse,
  SyncOp,
} from "@calmly/shared";
import { PullResponseSchema, PushResponseSchema } from "@calmly/shared";

export interface SyncClient {
  pull(since: number): Promise<PullResponse>;
  push(ops: SyncOp[]): Promise<PushResponse>;
}

export class SyncHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SyncHttpError";
  }
}

export interface CreateClientArgs {
  baseUrl: string;
  // Inject cookie header from Electron's session cookie jar. Production wiring
  // pulls this from session.defaultSession.cookies. Tests stub it.
  getCookieHeader: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export function createSyncClient(args: CreateClientArgs): SyncClient {
  const fetchFn = args.fetchImpl ?? fetch;
  const url = (path: string) => `${args.baseUrl.replace(/\/$/, "")}${path}`;

  const headers = async (): Promise<Record<string, string>> => {
    const h: Record<string, string> = {
      "content-type": "application/json",
    };
    const cookie = await args.getCookieHeader();
    if (cookie) h.cookie = cookie;
    return h;
  };

  return {
    async pull(since) {
      const res = await fetchFn(url("/sync/pull"), {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ since }),
      });
      if (!res.ok) {
        throw new SyncHttpError(`pull failed: ${res.status}`, res.status);
      }
      const json = (await res.json()) as unknown;
      return PullResponseSchema.parse(json);
    },
    async push(ops) {
      const body: PushRequest = { ops };
      const res = await fetchFn(url("/sync/push"), {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new SyncHttpError(`push failed: ${res.status}`, res.status);
      }
      const json = (await res.json()) as unknown;
      return PushResponseSchema.parse(json);
    },
  };
}
