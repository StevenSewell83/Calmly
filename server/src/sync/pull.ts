import type pg from "pg";
import type { PullResponse, SyncTable } from "@calmly/shared";
import { TABLES } from "./tables";

export async function pullSince(
  pool: pg.Pool,
  userId: string,
  since: number,
): Promise<PullResponse> {
  const records: PullResponse["records"] = {};
  let highestVersion = since;

  for (const tableName of Object.keys(TABLES) as SyncTable[]) {
    const spec = TABLES[tableName];
    const projection = [
      "id",
      "user_id",
      ...spec.columns.filter((c) => c !== "id" && c !== "user_id"),
      "updated_at",
      "deleted_at",
      "version",
    ].join(", ");
    const r = await pool.query<Record<string, unknown>>(
      `SELECT ${projection}
         FROM ${spec.name}
        WHERE user_id = $1 AND version > $2
        ORDER BY version ASC`,
      [userId, since],
    );
    if (r.rows.length > 0) records[tableName] = r.rows;
    for (const row of r.rows) {
      const v = Number(row.version ?? 0);
      if (v > highestVersion) highestVersion = v;
    }
  }

  return { records, version: highestVersion };
}
