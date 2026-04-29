import type Database from "better-sqlite3";
import { backoffDelayMs } from "./backoff";
import type { SyncClient } from "./client";
import { SyncHttpError } from "./client";
import {
  markAttempted,
  pendingOps,
  removeOp,
  queueSize,
  type QueuedOp,
} from "./queue";
import {
  getSyncState,
  updateLastPulledVersion,
  updateLastPushedAt,
} from "./state";

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  pendingAfter: number;
  lastPulledVersion: number;
  error?: string;
}

export interface LoopDeps {
  getDb: () => Database.Database;
  client: SyncClient;
  intervalMs?: number;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
}

interface OpsToPush {
  ops: {
    table: QueuedOp["table_name"];
    op: QueuedOp["op"];
    payload: Record<string, unknown>;
  }[];
  ids: string[];
}

function readyToPush(rows: QueuedOp[], now: number): QueuedOp[] {
  return rows.filter((r) => {
    if (r.attempts === 0) return true;
    return r.created_at + backoffDelayMs(r.attempts) <= now;
  });
}

function buildPushBatch(rows: QueuedOp[]): OpsToPush {
  const ops: OpsToPush["ops"] = [];
  const ids: string[] = [];
  for (const r of rows) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(r.payload_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    ops.push({ table: r.table_name, op: r.op, payload });
    ids.push(r.id);
  }
  return { ops, ids };
}

export async function runSyncOnce(deps: LoopDeps): Promise<SyncResult> {
  const db = deps.getDb();
  const state = getSyncState(db);
  let pushed = 0;
  let pulled = 0;
  let lastPulledVersion = state.last_pulled_version;

  // Push phase
  const candidates = readyToPush(pendingOps(db, 200), Date.now());
  if (candidates.length > 0) {
    const batch = buildPushBatch(candidates);
    try {
      const res = await deps.client.push(batch.ops);
      for (let i = 0; i < res.results.length; i++) {
        const r = res.results[i]!;
        const opId = batch.ids[i];
        if (!opId) continue;
        if (
          r.status === "accepted" ||
          r.status === "stale" ||
          r.status === "gone"
        ) {
          // Server has the canonical state — local op no longer needs replay.
          removeOp(db, opId);
          if (r.status === "accepted") pushed++;
        } else {
          markAttempted(db, opId, `invalid:${r.reason ?? "unknown"}`);
        }
      }
      updateLastPushedAt(db, Date.now());
    } catch (e) {
      const msg = e instanceof SyncHttpError ? `http:${e.status}` : String(e);
      for (const id of batch.ids) markAttempted(db, id, msg);
      deps.log?.("sync push failed", { error: msg });
      return {
        ok: false,
        pushed: 0,
        pulled: 0,
        pendingAfter: queueSize(db),
        lastPulledVersion,
        error: msg,
      };
    }
  }

  // Pull phase
  try {
    const res = await deps.client.pull(state.last_pulled_version);
    pulled = Object.values(res.records).reduce(
      (n, rows) => n + (rows?.length ?? 0),
      0,
    );
    if (res.version > state.last_pulled_version) {
      updateLastPulledVersion(db, res.version);
      lastPulledVersion = res.version;
    }
  } catch (e) {
    const msg = e instanceof SyncHttpError ? `http:${e.status}` : String(e);
    deps.log?.("sync pull failed", { error: msg });
    return {
      ok: false,
      pushed,
      pulled: 0,
      pendingAfter: queueSize(db),
      lastPulledVersion,
      error: msg,
    };
  }

  return {
    ok: true,
    pushed,
    pulled,
    pendingAfter: queueSize(db),
    lastPulledVersion,
  };
}

export interface SyncLoop {
  start(): void;
  stop(): void;
  syncNow(): Promise<SyncResult>;
}

export function createSyncLoop(deps: LoopDeps): SyncLoop {
  const interval = deps.intervalMs ?? 30_000;
  let timer: NodeJS.Timeout | null = null;
  let inFlight: Promise<SyncResult> | null = null;

  const tick = async (): Promise<SyncResult> => {
    if (inFlight) return inFlight;
    inFlight = runSyncOnce(deps);
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, interval);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    syncNow: tick,
  };
}
