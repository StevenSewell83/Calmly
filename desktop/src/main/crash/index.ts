// POL-03: Crash reporting — opt-in, separate from telemetry.
//
// crashReporter is already started in main/index.ts with uploadToServer: false.
// Enabling crash reports updates the submitURL + restartRequired flag; the
// actual restart is the user's responsibility (we banner them from the renderer).
//
// Identifiers stripped: no email, no anonymous_id, no task content.
// Only app_version, os, and process_type are included in the crash payload.
import { app, crashReporter } from "electron";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../db";

const SETTINGS_KEY = "crash.enabled";
const CRASH_INGEST_URL_ENV = "CALMLY_CRASH_INGEST_URL";

export interface CrashStatus {
  enabled: boolean;
  restartRequired: boolean;
  lastReportMeta: LastReportMeta | null;
}

export interface LastReportMeta {
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

let _enabledAtBoot: boolean | null = null;
let _restartRequired = false;

function getCrashIngestUrl(): string {
  return process.env[CRASH_INGEST_URL_ENV] ?? "https://crash-disabled.calmly.invalid/";
}

function readEnabled(): boolean {
  try {
    const row = getDb()
      .prepare("SELECT settings_json FROM user_settings LIMIT 1")
      .get() as { settings_json: string } | undefined;
    if (!row) return false;
    const j = JSON.parse(row.settings_json) as Record<string, unknown>;
    return j[SETTINGS_KEY] === true;
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean): void {
  const db = getDb();
  const row = db
    .prepare("SELECT settings_json FROM user_settings LIMIT 1")
    .get() as { settings_json: string } | undefined;
  const j: Record<string, unknown> = row ? JSON.parse(row.settings_json) : {};
  j[SETTINGS_KEY] = enabled;
  if (row) {
    db.prepare(
      "UPDATE user_settings SET settings_json = ?, updated_at = unixepoch() * 1000",
    ).run(JSON.stringify(j));
  } else {
    db.prepare(
      "INSERT INTO user_settings (settings_json, updated_at) VALUES (?, unixepoch() * 1000)",
    ).run(JSON.stringify(j));
  }
}

async function findLastReport(): Promise<LastReportMeta | null> {
  const dir = app.getPath("crashDumps");
  if (!dir) return null;
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const dumps = files.filter((f) => f.endsWith(".dmp") || f.endsWith(".gz"));
    if (dumps.length === 0) return null;
    // Sort by name (which encodes timestamp) and take latest.
    const latest = dumps.sort().at(-1)!;
    const fullPath = join(dir, latest);
    const s = await stat(fullPath);
    return { path: fullPath, sizeBytes: s.size, modifiedAt: s.mtimeMs };
  } catch {
    return null;
  }
}

export function initCrashReporting(): void {
  _enabledAtBoot = readEnabled();
  if (_enabledAtBoot) {
    crashReporter.start({
      productName: "Calmly",
      uploadToServer: true,
      submitURL: getCrashIngestUrl(),
      ignoreSystemCrashHandler: false,
    });
  }
  // If disabled, crashReporter was already started with uploadToServer: false in main/index.ts.
}

export function getCrashStatus(): Promise<CrashStatus> {
  const enabled = readEnabled();
  return findLastReport().then((lastReportMeta) => ({
    enabled,
    restartRequired: _restartRequired,
    lastReportMeta,
  }));
}

export function setCrashEnabled(enabled: boolean): void {
  const current = readEnabled();
  if (current === enabled) return;
  writeEnabled(enabled);
  _restartRequired = enabled !== _enabledAtBoot;
}
