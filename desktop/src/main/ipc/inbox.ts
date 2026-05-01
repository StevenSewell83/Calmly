import {
  addInboxItem,
  listInbox,
  skipInboxItem,
  snoozeInboxItem,
  type AddInboxItemResult,
  type InboxListRow,
  type SkipInboxResult,
  type SnoozeInboxResult,
} from "../inbox/store";
import { authedHandler, isStringId } from "./handler";

export type InboxAddResult =
  | AddInboxItemResult
  | { ok: false; error: "NotSignedIn" };

export type InboxListResult =
  | { ok: true; items: InboxListRow[] }
  | { ok: false; error: "NotSignedIn" };

export type InboxSnoozeResult =
  | SnoozeInboxResult
  | { ok: false; error: "NotSignedIn" };

export type InboxSkipResult =
  | SkipInboxResult
  | { ok: false; error: "NotSignedIn" };

export function registerInboxIpc(): void {
  authedHandler<InboxAddResult>("inbox:add", (ctx, raw) => {
    if (typeof raw !== "string") return { ok: false, error: "InvalidArgs" };
    return addInboxItem({ db: ctx.db, userId: ctx.userId, rawText: raw, source: "desktop" });
  });

  authedHandler<InboxListResult>("inbox:list", (ctx) => ({
    ok: true,
    items: listInbox(ctx.db, ctx.userId, ctx.now),
  }));

  // The renderer calls invoke("inbox:snooze", id, untilMs) — two separate
  // args. authedHandler bundles multi-arg calls into an array.
  authedHandler<InboxSnoozeResult>("inbox:snooze", (ctx, raw) => {
    const args = raw as unknown[];
    if (!Array.isArray(args) || !isStringId(args[0]) || typeof args[1] !== "number") {
      return { ok: false, error: "InvalidArgs" };
    }
    return snoozeInboxItem(ctx.db, ctx.userId, args[0], args[1] as number, ctx.now);
  });

  authedHandler<InboxSkipResult>("inbox:skip", (ctx, raw) => {
    if (!isStringId(raw)) return { ok: false, error: "InvalidArgs" };
    return skipInboxItem(ctx.db, ctx.userId, raw, ctx.now);
  });

  authedHandler<{ ok: boolean; count: number; error?: string }>("inbox:bulkAdd", (ctx, raw) => {
    if (!Array.isArray(raw)) return { ok: false, count: 0, error: "InvalidArgs" };
    let count = 0;
    for (const item of raw) {
      if (typeof item !== "string" || item.trim().length === 0) continue;
      const r = addInboxItem({ db: ctx.db, userId: ctx.userId, rawText: item.trim(), source: "ai-split" });
      if (r.ok) count++;
    }
    return { ok: true, count };
  });
}
