import {
  deleteReminderRule,
  getReminderRule,
  upsertReminderRule,
  type DeleteReminderRuleResult,
  type ReminderRuleRow,
  type UpsertReminderRuleResult,
} from "../reminders/store";
import { authedHandler, isObject, isStringId } from "./handler";

export type RemindersGetResult =
  | { ok: true; rule: ReminderRuleRow | null }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export type RemindersUpsertResult =
  | UpsertReminderRuleResult
  | { ok: false; error: "NotSignedIn" };

export type RemindersDeleteResult =
  | DeleteReminderRuleResult
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

export function registerRemindersIpc(): void {
  authedHandler<RemindersGetResult>("reminders:get", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId)) {
      return { ok: false, error: "InvalidArgs" };
    }
    return {
      ok: true,
      rule: getReminderRule(ctx.db, ctx.userId, raw.taskId),
    };
  });

  authedHandler<RemindersUpsertResult>("reminders:upsert", (ctx, raw) => {
    if (
      !isObject(raw) ||
      !isStringId(raw.taskId) ||
      typeof raw.importance !== "string" ||
      typeof raw.intervalSeconds !== "number" ||
      typeof raw.escalationJson !== "string" ||
      typeof raw.active !== "boolean"
    ) {
      return { ok: false, error: "InvalidArgs" };
    }
    return upsertReminderRule(
      ctx.db,
      ctx.userId,
      raw.taskId,
      {
        importance: raw.importance as ReminderRuleRow["importance"],
        intervalSeconds: raw.intervalSeconds,
        escalationJson: raw.escalationJson,
        active: raw.active,
      },
      ctx.now,
    );
  });

  authedHandler<RemindersDeleteResult>("reminders:delete", (ctx, raw) => {
    if (!isObject(raw) || !isStringId(raw.taskId)) {
      return { ok: false, error: "InvalidArgs" };
    }
    return deleteReminderRule(ctx.db, ctx.userId, raw.taskId, ctx.now);
  });
}
