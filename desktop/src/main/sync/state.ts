import type Database from "better-sqlite3";

export interface SyncState {
  last_pulled_version: number;
  last_pushed_at: number | null;
}

export function getSyncState(db: Database.Database): SyncState {
  const row = db
    .prepare(
      "SELECT last_pulled_version, last_pushed_at FROM sync_state WHERE id = 1",
    )
    .get() as SyncState | undefined;
  return row ?? { last_pulled_version: 0, last_pushed_at: null };
}

export function updateLastPulledVersion(
  db: Database.Database,
  version: number,
): void {
  db.prepare("UPDATE sync_state SET last_pulled_version = ? WHERE id = 1").run(
    version,
  );
}

export function updateLastPushedAt(db: Database.Database, ts: number): void {
  db.prepare("UPDATE sync_state SET last_pushed_at = ? WHERE id = 1").run(ts);
}
