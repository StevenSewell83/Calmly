import type {
  PullResponse,
  PushRequest,
  PushResponse,
  SyncOp,
  SyncTable,
} from "@calmly/shared";
import { PushResponseSchema, WirePullResponseSchema } from "@calmly/shared";

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

  const fetchOnePage = async (cursor: number) => {
    const res = await fetchFn(url("/sync/pull"), {
      method: "POST",
      headers: await headers(),
      body: JSON.stringify({ since: cursor }),
    });
    if (!res.ok) {
      throw new SyncHttpError(`pull failed: ${res.status}`, res.status);
    }
    const json = (await res.json()) as unknown;
    return WirePullResponseSchema.parse(json);
  };

  return {
    // Loops through paginated wire responses (LIMIT 1000/table/round-trip)
    // and returns a flat PullResponse with all rows aggregated.
    async pull(since) {
      const allRows: Record<string, Record<string, unknown>[]> = {};
      let cursor = since;

      while (true) {
        const page = await fetchOnePage(cursor);
        let anyMore = false;
        for (const [table, entry] of Object.entries(page.records) as [SyncTable, typeof page.records[SyncTable]][]) {
          if (!entry) continue;
          if (!allRows[table]) allRows[table] = [];
          allRows[table]!.push(...entry.rows);
          if (entry.hasMore) anyMore = true;
        }
        if (page.version > cursor) cursor = page.version;
        if (!anyMore) {
          return { records: allRows as PullResponse["records"], version: cursor };
        }
        // Safety: if version didn't advance, there's nothing left to fetch.
        if (page.version <= since && !Object.values(page.records).some(e => e?.rows.length)) {
          return { records: allRows as PullResponse["records"], version: cursor };
        }
      }
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
