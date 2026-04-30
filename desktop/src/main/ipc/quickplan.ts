import { authedHandler } from "./handler";

interface SettingsJson {
  last_quickplan_date?: string;
  quickplan_skipped_dates?: string[];
}

function readSettings(db: import("better-sqlite3").Database, userId: string): SettingsJson {
  const row = db
    .prepare("SELECT settings_json FROM user_settings WHERE user_id = ?")
    .get(userId) as { settings_json: string } | undefined;
  if (!row) return {};
  try {
    return JSON.parse(row.settings_json) as SettingsJson;
  } catch {
    return {};
  }
}

function writeSettings(
  db: import("better-sqlite3").Database,
  userId: string,
  patch: Partial<SettingsJson>,
  now: number,
): void {
  const current = readSettings(db, userId);
  const next = JSON.stringify({ ...current, ...patch });
  db.prepare(
    `UPDATE user_settings SET settings_json = ?, updated_at = ? WHERE user_id = ?`,
  ).run(next, now, userId);
}

export function registerQuickPlanIpc(): void {
  authedHandler<{ ok: true; date: string | null }>(
    "quickplan:getDate",
    (ctx) => {
      const s = readSettings(ctx.db, ctx.userId);
      return { ok: true, date: s.last_quickplan_date ?? null };
    },
  );

  authedHandler<{ ok: true }>("quickplan:setDate", (ctx, raw) => {
    const date = typeof raw === "string" ? raw : null;
    writeSettings(ctx.db, ctx.userId, { last_quickplan_date: date ?? "" }, ctx.now);
    return { ok: true };
  });
}
