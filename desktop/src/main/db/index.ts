import Database from "better-sqlite3";
import { app } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runMigrations } from "./migrations";

interface DbState {
  db: Database.Database;
  path: string;
  version: number;
}

let state: DbState | null = null;

export interface InitDbResult {
  path: string;
  version: number;
  appliedNow: number[];
}

export function initDb(): InitDbResult {
  if (state) {
    return { path: state.path, version: state.version, appliedNow: [] };
  }
  const userData = app.getPath("userData");
  mkdirSync(userData, { recursive: true });
  const dbPath = join(userData, "calmly.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  const result = runMigrations(db);
  state = { db, path: dbPath, version: result.current };
  return {
    path: dbPath,
    version: result.current,
    appliedNow: result.appliedNow,
  };
}

export function getDb(): Database.Database {
  if (!state) throw new Error("Database not initialized — call initDb() first");
  return state.db;
}

export function getDbPath(): string {
  if (!state) throw new Error("Database not initialized");
  return state.path;
}

export function getDbVersion(): number {
  return state?.version ?? 0;
}

export function closeDb(): void {
  state?.db.close();
  state = null;
}
