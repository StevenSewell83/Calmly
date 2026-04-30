import { DEFAULT_SERVER_URL, validateServerUrl } from "@calmly/shared";
import type Database from "better-sqlite3";

const ENV_OVERRIDE = process.env["CALMLY_SYNC_URL"];

/** Reads the persisted custom server URL from user_settings. */
function readStoredUrl(db: Database.Database): string | null {
  try {
    const row = db
      .prepare(
        "SELECT settings_json FROM user_settings LIMIT 1",
      )
      .get() as { settings_json: string } | undefined;
    if (!row) return null;
    const settings = JSON.parse(row.settings_json) as Record<string, unknown>;
    const url = settings["syncServerUrl"];
    if (typeof url !== "string" || !url) return null;
    const v = validateServerUrl(url);
    return v.ok ? v.url : null;
  } catch {
    return null;
  }
}

/** Persists a custom server URL into user_settings. */
export function saveServerUrl(db: Database.Database, url: string): void {
  const v = validateServerUrl(url);
  if (!v.ok) throw new Error(`Invalid server URL: ${url}`);

  const existing = db
    .prepare("SELECT settings_json FROM user_settings LIMIT 1")
    .get() as { settings_json: string } | undefined;

  if (existing) {
    const settings = JSON.parse(existing.settings_json) as Record<string, unknown>;
    settings["syncServerUrl"] = v.url;
    db.prepare("UPDATE user_settings SET settings_json = ?").run(
      JSON.stringify(settings),
    );
  } else {
    db.prepare("INSERT INTO user_settings (settings_json) VALUES (?)").run(
      JSON.stringify({ syncServerUrl: v.url }),
    );
  }
}

/** Clears the custom server URL from user_settings. */
export function clearServerUrl(db: Database.Database): void {
  const existing = db
    .prepare("SELECT settings_json FROM user_settings LIMIT 1")
    .get() as { settings_json: string } | undefined;
  if (!existing) return;
  const settings = JSON.parse(existing.settings_json) as Record<string, unknown>;
  delete settings["syncServerUrl"];
  db.prepare("UPDATE user_settings SET settings_json = ?").run(
    JSON.stringify(settings),
  );
}

/**
 * Resolves the active sync server URL.
 * Priority: env override > stored user setting > bundled default.
 */
export function resolveServerUrl(db: Database.Database): string {
  if (ENV_OVERRIDE) {
    const v = validateServerUrl(ENV_OVERRIDE);
    if (v.ok) return v.url;
  }
  return readStoredUrl(db) ?? DEFAULT_SERVER_URL;
}
