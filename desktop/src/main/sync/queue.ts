import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SyncTable } from "@calmly/shared";

export interface QueuedOp {
  id: string;
  table_name: SyncTable;
  op: "upsert" | "delete";
  payload_json: string;
  created_at: number;
  attempts: number;
  last_error: string | null;
}

export interface EnqueueArgs {
  table: SyncTable;
  op: "upsert" | "delete";
  payload: Record<string, unknown>;
}

export function enqueueOp(db: Database.Database, args: EnqueueArgs): QueuedOp {
  const id = randomUUID();
  const json = JSON.stringify(args.payload);
  db.prepare(
    `INSERT INTO op_queue (id, table_name, op, payload_json)
     VALUES (?, ?, ?, ?)`,
  ).run(id, args.table, args.op, json);
  return {
    id,
    table_name: args.table,
    op: args.op,
    payload_json: json,
    created_at: Date.now(),
    attempts: 0,
    last_error: null,
  };
}

export function pendingOps(db: Database.Database, limit = 100): QueuedOp[] {
  return db
    .prepare(
      `SELECT id, table_name, op, payload_json, created_at, attempts, last_error
         FROM op_queue
        ORDER BY created_at ASC
        LIMIT ?`,
    )
    .all(limit) as QueuedOp[];
}

export function markAttempted(
  db: Database.Database,
  id: string,
  error: string | null,
): void {
  db.prepare(
    `UPDATE op_queue
        SET attempts = attempts + 1,
            last_error = ?
      WHERE id = ?`,
  ).run(error, id);
}

export function removeOp(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM op_queue WHERE id = ?").run(id);
}

export function queueSize(db: Database.Database): number {
  const r = db.prepare("SELECT count(*) AS c FROM op_queue").get() as
    | { c: number }
    | undefined;
  return r?.c ?? 0;
}
