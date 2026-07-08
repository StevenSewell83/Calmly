// POL-01: Desktop telemetry outbox + flush worker.
//
// Events are buffered in SQLite and flushed in batches to /telemetry/ingest.
// Emission is gated on `telemetry.enabled` from user_settings. When the user
// disables telemetry, the outbox is purged immediately and flushing stops.
//
// The anonymous_id is a stable per-device UUID stored in the secret store.
// It is never correlated with the user account or email.

import { randomUUID } from "node:crypto";
import { getDb } from "../db";
import { secretStore } from "../security/secretStore";
import type { ApiClient } from "../net/client";
import {
  TelemetryBatchSchema,
  type TelemetryEvent,
  type TelemetryEventName,
} from "@calmly/shared";

const FLUSH_INTERVAL_MS = 60_000;
const BATCH_SIZE = 50;

let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushClient: ApiClient | null = null;
let sessionId: string = randomUUID();

// ── anonymous_id ────────────────────────────────────────────────────────────

export function getOrCreateAnonymousId(): string {
  const existing = secretStore.get("telemetry.anonymous_id");
  if (existing) return existing;
  const id = randomUUID();
  try {
    secretStore.set("telemetry.anonymous_id", id);
  } catch {
    // safeStorage unavailable — return the in-process id; won't persist.
  }
  return id;
}

// ── settings ─────────────────────────────────────────────────────────────────

function isTelemetryEnabled(): boolean {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT settings_json FROM user_settings LIMIT 1")
      .get() as { settings_json: string } | undefined;
    if (!row) return false;
    const j = JSON.parse(row.settings_json) as Record<string, unknown>;
    return j["telemetry.enabled"] === true;
  } catch {
    return false;
  }
}

// ── emit ──────────────────────────────────────────────────────────────────────

export function emitTelemetryEvent(
  eventName: TelemetryEventName,
  props?: Record<string, boolean | number | string>,
): void {
  if (!isTelemetryEnabled()) return;
  try {
    const db = getDb();
    const id = randomUUID();
    const anonymousId = getOrCreateAnonymousId();
    db.prepare(
      `INSERT INTO telemetry_outbox
         (id, event_name, anonymous_id, session_id, props_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      eventName,
      anonymousId,
      sessionId,
      JSON.stringify(props ?? {}),
      Date.now(),
    );
    // Flush immediately if batch is full.
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM telemetry_outbox").get() as {
        n: number;
      }
    ).n;
    if (count >= BATCH_SIZE) {
      void flushOutbox();
    }
  } catch {
    // Never let telemetry crash the caller.
  }
}

// ── flush ─────────────────────────────────────────────────────────────────────

async function flushOutbox(): Promise<void> {
  if (!flushClient || !isTelemetryEnabled()) return;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, event_name, anonymous_id, session_id, props_json, created_at
         FROM telemetry_outbox
         ORDER BY created_at ASC
         LIMIT ?`,
    )
    .all(BATCH_SIZE) as Array<{
    id: string;
    event_name: string;
    anonymous_id: string;
    session_id: string;
    props_json: string;
    created_at: number;
  }>;

  if (rows.length === 0) return;

  const events: TelemetryEvent[] = rows.map((r) => ({
    event: r.event_name as TelemetryEvent["event"],
    anonymous_id: r.anonymous_id,
    session_id: r.session_id,
    timestamp: r.created_at,
    props: JSON.parse(r.props_json) as Record<
      string,
      boolean | number | string
    >,
  }));

  const batch = TelemetryBatchSchema.safeParse({ events });
  if (!batch.success) {
    // Invalid rows — drop them so they don't block future flushes.
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM telemetry_outbox WHERE id IN (${placeholders})`,
    ).run(...ids);
    return;
  }

  try {
    await flushClient.request("POST", "/telemetry/ingest", batch.data);
    const ids = rows.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(
      `DELETE FROM telemetry_outbox WHERE id IN (${placeholders})`,
    ).run(...ids);
  } catch {
    // Network failure — leave rows in outbox for the next flush.
  }
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

export function startTelemetryWorker(apiClient: ApiClient): void {
  flushClient = apiClient;
  sessionId = randomUUID();
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushOutbox();
  }, FLUSH_INTERVAL_MS);
}

export function stopTelemetryWorker(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushClient = null;
}

export function purgeOutbox(): void {
  try {
    getDb().prepare("DELETE FROM telemetry_outbox").run();
  } catch {
    // Ignore if DB not available.
  }
}
