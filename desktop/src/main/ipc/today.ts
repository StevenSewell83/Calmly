import {
  countUnresolvedInbox,
  listTodayEvents,
  listTodayTasks,
  type EventTodayRow,
  type TaskTodayRow,
} from "../today/store";
import { authedHandler } from "./handler";

export type ListTodayTasksResult =
  | { ok: true; tasks: TaskTodayRow[] }
  | { ok: false; error: "NotSignedIn" };

export type ListTodayEventsResult =
  | { ok: true; events: EventTodayRow[] }
  | { ok: false; error: "NotSignedIn" };

export type UnresolvedInboxCountResult =
  | { ok: true; count: number }
  | { ok: false; error: "NotSignedIn" };

export function registerTodayIpc(): void {
  authedHandler<ListTodayTasksResult>("tasks:listToday", (ctx) => ({
    ok: true,
    tasks: listTodayTasks(ctx.db, ctx.userId, ctx.now, ctx.tz),
  }));

  authedHandler<ListTodayEventsResult>("events:listToday", (ctx) => ({
    ok: true,
    events: listTodayEvents(ctx.db, ctx.userId, ctx.now, ctx.tz),
  }));

  authedHandler<UnresolvedInboxCountResult>("inbox:unresolvedCount", (ctx) => ({
    ok: true,
    count: countUnresolvedInbox(ctx.db, ctx.userId, ctx.now),
  }));
}
