import { session } from "electron";
import type Database from "better-sqlite3";
import { createSyncClient } from "../sync/client";
import { createSyncLoop, type SyncLoop } from "../sync/loop";

export function createSyncBootstrap(opts: {
  getDb: () => Database.Database;
  apiBaseUrl: string;
}): SyncLoop {
  return createSyncLoop({
    getDb: opts.getDb,
    client: createSyncClient({
      baseUrl: opts.apiBaseUrl,
      getCookieHeader: async () => {
        try {
          const cookies = await session.defaultSession.cookies.get({
            url: opts.apiBaseUrl,
          });
          if (cookies.length === 0) return null;
          return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
        } catch {
          return null;
        }
      },
    }),
    log: (msg, fields) => console.log(`[calmly:sync] ${msg}`, fields ?? {}),
  });
}
