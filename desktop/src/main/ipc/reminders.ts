import type Database from "better-sqlite3";
import {
  DEFAULT_IMPORTANT_REMINDER_INTERVAL_SECONDS,
  DEFAULT_SOFT_REMINDER_INTERVAL_SECONDS,
  MIN_REMINDER_INTERVAL_SECONDS,
} from "@calmly/shared";
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

// RM-02 profile defaults — Important/Soft interval applied to a task's
// rule the first time it's created (see ReminderRuleEditor's "Add
// reminder" affordance). Stored on the shared user_settings JSON blob
// rather than a new table (no per-task fan-out, no sync surface needed).
export interface ReminderDefaults {
  importantIntervalSeconds: number;
  softIntervalSeconds: number;
}

export type RemindersGetDefaultsResult =
  | { ok: true; defaults: ReminderDefaults }
  | { ok: false; error: "NotSignedIn" };

export type RemindersSetDefaultsResult =
  | { ok: true }
  | { ok: false; error: "NotSignedIn" | "InvalidArgs" };

interface DefaultsSettingsJson {
  "reminders.importantIntervalSeconds"?: number;
  "reminders.softIntervalSeconds"?: number;
}

// Mirrors the read/update-only convention already used by quickplan.ts
// and review/store.ts for per-user settings: a user_settings row is
// assumed to exist once the user is signed in, so there's no INSERT
// fallback here — same as those two call sites.
function readReminderDefaults(
  db: Database.Database,
  userId: string,
): ReminderDefaults {
  const row = db
    .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
    .get(userId) as { settings_json: string } | undefined;
  let j: DefaultsSettingsJson = {};
  if (row) {
    try {
      j = JSON.parse(row.settings_json) as DefaultsSettingsJson;
    } catch {
      j = {};
    }
  }
  return {
    importantIntervalSeconds:
      j["reminders.importantIntervalSeconds"] ?? DEFAULT_IMPORTANT_REMINDER_INTERVAL_SECONDS,
    softIntervalSeconds:
      j["reminders.softIntervalSeconds"] ?? DEFAULT_SOFT_REMINDER_INTERVAL_SECONDS,
  };
}

function writeReminderDefaults(
  db: Database.Database,
  userId: string,
  patch: Partial<ReminderDefaults>,
  now: number,
): void {
  const row = db
    .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
    .get(userId) as { settings_json: string } | undefined;
  let j: DefaultsSettingsJson = {};
  if (row) {
    try {
      j = JSON.parse(row.settings_json) as DefaultsSettingsJson;
    } catch {
      j = {};
    }
  }
  if (patch.importantIntervalSeconds !== undefined) {
    j["reminders.importantIntervalSeconds"] = patch.importantIntervalSeconds;
  }
  if (patch.softIntervalSeconds !== undefined) {
    j["reminders.softIntervalSeconds"] = patch.softIntervalSeconds;
  }
  db.prepare(
    `UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`,
  ).run(JSON.stringify(j), now, userId);
}

function isValidDefaultInterval(v: unknown): v is number {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    Number.isInteger(v) &&
    v >= MIN_REMINDER_INTERVAL_SECONDS
  );
}

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

  authedHandler<RemindersGetDefaultsResult>("reminders:getDefaults", (ctx) => {
    return { ok: true, defaults: readReminderDefaults(ctx.db, ctx.userId) };
  });

  authedHandler<RemindersSetDefaultsResult>("reminders:setDefaults", (ctx, raw) => {
    if (!isObject(raw)) return { ok: false, error: "InvalidArgs" };
    const patch: Partial<ReminderDefaults> = {};
    if (raw.importantIntervalSeconds !== undefined) {
      if (!isValidDefaultInterval(raw.importantIntervalSeconds)) {
        return { ok: false, error: "InvalidArgs" };
      }
      patch.importantIntervalSeconds = raw.importantIntervalSeconds;
    }
    if (raw.softIntervalSeconds !== undefined) {
      if (!isValidDefaultInterval(raw.softIntervalSeconds)) {
        return { ok: false, error: "InvalidArgs" };
      }
      patch.softIntervalSeconds = raw.softIntervalSeconds;
    }
    writeReminderDefaults(ctx.db, ctx.userId, patch, ctx.now);
    return { ok: true };
  });
}
