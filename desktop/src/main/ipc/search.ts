import { ipcMain } from "electron";
import { getDb } from "../db";
import { authedHandler } from "./handler";
import { searchAll } from "../search";
import type { SearchHit } from "@calmly/shared";

export type SearchResult =
  | { ok: true; hits: SearchHit[] }
  | { ok: false; error: "NotSignedIn" | "InternalError" };

export function registerSearchIpc(): void {
  authedHandler<SearchResult>("search:query", (ctx, raw) => {
    const q = typeof raw === "string" ? raw : "";
    if (!q.trim()) return { ok: true, hits: [] };
    try {
      const hits = searchAll(getDb(), ctx.userId, q, 30);
      return { ok: true, hits };
    } catch {
      return { ok: false, error: "InternalError" };
    }
  });
}
