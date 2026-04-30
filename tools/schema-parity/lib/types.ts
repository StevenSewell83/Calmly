/**
 * Shared types for the schema-parity tool. Kept separate so the parsers
 * and the comparator can import them without pulling on one another.
 */

/** Coarse type bucket — tight enough to catch shape drift, loose enough
 * to ignore SQLite vs Postgres affinity differences (BIGINT vs INTEGER,
 * TEXT vs VARCHAR, etc.). */
export type ColumnTypeBucket =
  | "string"
  | "number"
  | "boolean"
  | "json"
  | "blob"
  | "unknown";

export interface ColumnInfo {
  /** Type bucket, used by the comparator. */
  bucket: ColumnTypeBucket;
  /** Original type token from the source (`TEXT`, `bigint`, `z.string`...). */
  rawType: string;
  /** True if the source declares the column as nullable (loose check). */
  nullable: boolean;
}

/** Map of tableName → columnName → column info. */
export type SourceTables = Record<string, Record<string, ColumnInfo>>;

export interface AllowedDivergence {
  table: string;
  column: string;
  presentIn: Array<"shared" | "desktop" | "server">;
  absentIn: Array<"shared" | "desktop" | "server">;
  reason: string;
}

export interface AllowedTable {
  table: string;
  presentIn: Array<"shared" | "desktop" | "server">;
  absentIn: Array<"shared" | "desktop" | "server">;
  reason: string;
}

export interface AllowList {
  divergences: AllowedDivergence[];
  /** Whole-table allow-listing for sources that legitimately don't have a
   * given table at all (e.g. server-only `magic_link_tokens`, desktop-only
   * `secrets`, local-only `focus_sessions`). When present, the comparator
   * skips column-level checks for that table for the absent source. */
  tables?: AllowedTable[];
}
