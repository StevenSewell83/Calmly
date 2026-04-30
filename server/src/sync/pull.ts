import type pg from "pg";
import type { SyncTable, WirePullResponse } from "@calmly/shared";
import { TABLES } from "./tables";

const PAGE_SIZE = 1000;

export async function pullSince(
  pool: pg.Pool,
  userId: string,
  since: number,
): Promise<WirePullResponse> {
  const records: WirePullResponse["records"] = {};
  let highestVersion = since;

  for (const tableName of Object.keys(TABLES) as SyncTable[]) {
    const spec = TABLES[tableName];
    if (!spec) continue;
    const projection = [
      ...(spec.name === "user_settings" ? [] : ["id"]),
      "user_id",
      ...spec.columns.filter((c) => c !== "id" && c !== "user_id"),
      "updated_at",
      "deleted_at",
      "version",
    ].join(", ");
    // Fetch one extra row to detect whether there are more pages.
    const r = await pool.query<Record<string, unknown>>(
      `SELECT ${projection}
         FROM ${spec.name}
        WHERE user_id = $1 AND version > $2
        ORDER BY version ASC
        LIMIT ${PAGE_SIZE + 1}`,
      [userId, since],
    );
    const hasMore = r.rows.length > PAGE_SIZE;
    const rows = hasMore ? r.rows.slice(0, PAGE_SIZE) : r.rows;
    records[tableName] = { rows, hasMore };
    for (const row of rows) {
      const v = Number(row.version ?? 0);
      if (v > highestVersion) highestVersion = v;
    }
  }

  return { records, version: highestVersion };
}
