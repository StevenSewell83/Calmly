import { ipcMain } from "electron";
import { getDb, getDbVersion } from "../db";

export interface DbHealth {
  ok: boolean;
  version: number;
  walMode: string;
  fts5: boolean;
}

let registered = false;

export function registerDbIpc(): void {
  if (registered) return;
  registered = true;

  ipcMain.handle("db:health", (): DbHealth => {
    const db = getDb();
    const journalMode = db.pragma("journal_mode", { simple: true }) as string;
    const ftsRow = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name='_fts5_smoketest' LIMIT 1",
      )
      .get() as { name: string } | undefined;
    return {
      ok: true,
      version: getDbVersion(),
      walMode: journalMode,
      fts5: !!ftsRow,
    };
  });
}
