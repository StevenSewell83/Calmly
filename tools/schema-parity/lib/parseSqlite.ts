/**
 * Regex-based parser for the desktop SQLite migrations.
 * The migrations are hand-written in a uniform style — strict tables,
 * canonical CREATE / ALTER TABLE forms — so a tokenless parser is fine.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { ColumnInfo, ColumnTypeBucket, SourceTables } from "./types";

/** Strip block + line comments. */
function stripComments(sql: string): string {
  // remove /* ... */ blocks (non-greedy)
  let out = sql.replace(/\/\*[\s\S]*?\*\//g, "");
  // remove `-- ...` to end-of-line
  out = out.replace(/--[^\n]*/g, "");
  return out;
}

function bucketForSqliteType(rawType: string): ColumnTypeBucket {
  const t = rawType.trim().toUpperCase();
  if (/INT/.test(t)) return "number";
  if (/CHAR|CLOB|TEXT/.test(t)) return "string";
  if (/REAL|FLOA|DOUB|NUMERIC|DECIMAL/.test(t)) return "number";
  if (/BLOB/.test(t)) return "blob";
  if (/BOOL/.test(t)) return "boolean";
  return "unknown";
}

/** Parse the column-list body of a CREATE TABLE statement, splitting on
 * top-level commas (depth 0 paren). Returns the textual definitions, in
 * order. Constraint-only rows (PRIMARY KEY/UNIQUE/CHECK/FOREIGN KEY at
 * the top level) are filtered out by the caller. */
export function splitColumnDefs(body: string): string[] {
  const defs: string[] = [];
  let depth = 0;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      defs.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) defs.push(buf.trim());
  return defs;
}

const TABLE_LEVEL_KEYWORDS = new Set([
  "PRIMARY",
  "UNIQUE",
  "CHECK",
  "FOREIGN",
  "CONSTRAINT",
]);

interface ParsedColumn {
  name: string;
  rawType: string;
  nullable: boolean;
  /** True if the column carries a `CHECK (json_valid(<col>))` constraint
   * — SQLite's idiom for a JSON column. We use this to bucket the column
   * as `json` so it lines up with Postgres `jsonb`. */
  jsonChecked: boolean;
}

function parseColumnDef(def: string): ParsedColumn | null {
  // Quick skip — table-level constraints, not column declarations.
  const firstWord = def.split(/\s+/, 1)[0]?.toUpperCase() ?? "";
  if (TABLE_LEVEL_KEYWORDS.has(firstWord)) return null;

  // Match: <name> <type> [rest...]
  // Names can be quoted with " or `, but the migrations don't quote them.
  const m = def.match(
    /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z]+(?:\s*\([^)]*\))?)?([\s\S]*)$/,
  );
  if (!m) return null;
  const name = m[1] as string;
  const rawType = (m[2] ?? "").trim();
  const rest = m[3] ?? "";
  const isNotNull = /\bNOT\s+NULL\b/i.test(rest);
  const isPk = /\bPRIMARY\s+KEY\b/i.test(rest);
  const jsonChecked = /\bjson_valid\s*\(/i.test(rest);
  return {
    name,
    rawType,
    // PRIMARY KEY columns in SQLite are not implicitly NOT NULL but in our
    // STRICT migrations every PK is also a PK. Treat PK as not-nullable to
    // match how it appears in zod (uuid required, not nullable).
    nullable: !isNotNull && !isPk,
    jsonChecked,
  };
}

/** Strip a leading IF NOT EXISTS clause from a CREATE TABLE pre-name. */
function stripIfNotExists(s: string): string {
  return s.replace(/^IF\s+NOT\s+EXISTS\s+/i, "");
}

export function parseSqliteSql(sql: string): SourceTables {
  const stripped = stripComments(sql);
  const tables: SourceTables = {};

  // CREATE TABLE [IF NOT EXISTS] name ( body ) [STRICT];
  const createRe =
    /CREATE\s+TABLE\s+([\s\S]*?)\(([\s\S]*?)\)\s*(?:STRICT|WITHOUT\s+ROWID)?\s*;/gi;
  for (const m of stripped.matchAll(createRe)) {
    const preName = stripIfNotExists((m[1] ?? "").trim());
    // preName is just `name` after stripping IF NOT EXISTS; drop trailing
    // whitespace / quote chars defensively.
    const name = preName.replace(/["`]/g, "").trim();
    if (!name) continue;
    // Skip virtual tables (FTS smoketest) — they don't have a normal column list.
    if (/USING\s+/i.test(preName)) continue;

    const body = m[2] ?? "";
    const cols: Record<string, ColumnInfo> = {};
    for (const def of splitColumnDefs(body)) {
      const parsed = parseColumnDef(def);
      if (!parsed) continue;
      const baseBucket = bucketForSqliteType(parsed.rawType);
      cols[parsed.name] = {
        bucket: parsed.jsonChecked ? "json" : baseBucket,
        rawType: parsed.rawType.toUpperCase(),
        nullable: parsed.nullable,
      };
    }
    tables[name] = cols;
  }

  // CREATE VIRTUAL TABLE [IF NOT EXISTS] name USING fts5(...) — ignored.
  // ALTER TABLE name ADD COLUMN col type [constraints]
  const alterRe =
    /ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z]+(?:\s*\([^)]*\))?)([^;]*);/gi;
  for (const m of stripped.matchAll(alterRe)) {
    const tableName = (m[1] ?? "") as string;
    const colName = (m[2] ?? "") as string;
    const rawType = ((m[3] ?? "") as string).trim();
    const rest = (m[4] ?? "") as string;
    const isNotNull = /\bNOT\s+NULL\b/i.test(rest);
    if (!tables[tableName]) tables[tableName] = {};
    tables[tableName][colName] = {
      bucket: bucketForSqliteType(rawType),
      rawType: rawType.toUpperCase(),
      nullable: !isNotNull,
    };
  }

  // ALTER TABLE name DROP COLUMN col — remove the column from the
  // accumulated schema. Without this, a follow-up DROP migration
  // (e.g. 0010_drop_user_magic_link_cols.sql) would still surface
  // the dropped column in the parity check.
  const dropRe =
    /ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+DROP\s+COLUMN\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gi;
  for (const m of stripped.matchAll(dropRe)) {
    const tableName = (m[1] ?? "") as string;
    const colName = (m[2] ?? "") as string;
    const tbl = tables[tableName];
    if (tbl && colName in tbl) delete tbl[colName];
  }

  // DROP TABLE name; — the table is gone. Used by table-rebuild
  // migrations (e.g. 0011_user_settings_id_pk.sql) that CREATE a
  // staging table, copy rows in, then DROP + RENAME.
  const dropTableRe =
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*;/gi;
  for (const m of stripped.matchAll(dropTableRe)) {
    const tableName = (m[1] ?? "") as string;
    delete tables[tableName];
  }

  // ALTER TABLE old RENAME TO new; — relocate the column map. Same
  // rebuild pattern: the staging table gets renamed onto the canonical
  // name once its rows are loaded.
  const renameRe =
    /ALTER\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+RENAME\s+TO\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gi;
  for (const m of stripped.matchAll(renameRe)) {
    const oldName = (m[1] ?? "") as string;
    const newName = (m[2] ?? "") as string;
    const cols = tables[oldName];
    if (cols) {
      tables[newName] = cols;
      delete tables[oldName];
    }
  }

  return tables;
}

export function parseSqliteMigrations(dir: string): SourceTables {
  if (!fs.existsSync(dir)) return {};
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const concatenated = files
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
  return parseSqliteSql(concatenated);
}
