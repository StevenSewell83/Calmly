/**
 * Regex-based parser for the server's node-pg-migrate `.cjs` migrations.
 *
 * The migrations are uniform: they call `pgm.createTable(name, { ... })`
 * and `pgm.addColumns(name, { ... })` (also `pgm.addColumn` singular).
 * Object-spread is used for shared sync columns (`...sync`); we resolve
 * a small set of known spreads textually.
 *
 * We deliberately avoid `require()`-ing the migration files because they
 * are CJS modules with side-effects on a `pgm` object — mocking that
 * shape correctly is more code than a regex parser, and the regex parser
 * stays readable as long as the migrations follow the established style.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { ColumnInfo, ColumnTypeBucket, SourceTables } from "./types";

function bucketForPgType(rawType: string): ColumnTypeBucket {
  const t = rawType.trim().toLowerCase();
  if (/^(text|varchar|char|citext|uuid)/.test(t)) return "string";
  if (
    /^(int|smallint|bigint|integer|numeric|real|double|decimal|serial|bigserial)/.test(
      t,
    )
  )
    return "number";
  if (/^bool/.test(t)) return "boolean";
  if (/^(json|jsonb)/.test(t)) return "json";
  if (/^bytea/.test(t)) return "blob";
  if (/^timestamp/.test(t)) return "number";
  return "unknown";
}

/**
 * Walk the source for the next balanced `(...)` starting at `start`.
 * Returns [innerText, indexAfterClosingParen].
 */
function readParens(src: string, start: number): [string, number] {
  if (src[start] !== "(") throw new Error(`expected '(' at ${start}`);
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch as '"' | "'" | "`";
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return [src.slice(start + 1, i), i + 1];
    }
  }
  throw new Error("unbalanced parentheses");
}

/** Split a brace-delimited object body on top-level commas. */
export function splitObjectEntries(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (inString) {
      buf += ch;
      if (ch === "\\" && i + 1 < body.length) {
        buf += body[i + 1] as string;
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch as '"' | "'" | "`";
      buf += ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Parse the body of an `{ ... }` columns object. Returns the column map.
 * `spreads` is a registry of named groups (e.g. `sync`) — when an entry
 * is `...name`, the columns from that group are merged in. */
export function parseColumnsObject(
  body: string,
  spreads: Record<string, Record<string, ColumnInfo>>,
): Record<string, ColumnInfo> {
  const cols: Record<string, ColumnInfo> = {};
  for (const entry of splitObjectEntries(body)) {
    // Handle ...sync style spreads.
    const spread = entry.match(/^\.\.\.\s*([A-Za-z_$][\w$]*)/);
    if (spread) {
      const groupName = spread[1] as string;
      const group = spreads[groupName];
      if (group) {
        for (const [k, v] of Object.entries(group)) cols[k] = v;
      }
      continue;
    }

    // Match `name: { ... }` or `name: "type"` or `"name": { ... }`
    const m = entry.match(/^["']?([A-Za-z_][\w]*)["']?\s*:\s*([\s\S]+)$/);
    if (!m) continue;
    const colName = m[1] as string;
    const valuePart = (m[2] as string).trim();

    let rawType = "";
    let nullable = true;

    if (valuePart.startsWith("{")) {
      // Inline object describing the column.
      const close = valuePart.lastIndexOf("}");
      const inner = close > 0 ? valuePart.slice(1, close) : valuePart.slice(1);
      // type:
      const typeMatch = inner.match(/\btype\s*:\s*["']([^"']+)["']/);
      if (typeMatch) rawType = typeMatch[1] as string;
      // notNull / primaryKey -> not nullable
      const notNull =
        /\bnotNull\s*:\s*true/.test(inner) ||
        /\bprimaryKey\s*:\s*true/.test(inner);
      nullable = !notNull;
    } else {
      // Shorthand string `name: "type"`.
      const literal = valuePart.match(/^["']([^"']+)["']/);
      if (literal) rawType = literal[1] as string;
    }

    cols[colName] = {
      bucket: bucketForPgType(rawType),
      rawType,
      nullable,
    };
  }
  return cols;
}

/** Find every `const NAME = { ... };` literal whose body looks like a
 * column-set (i.e. one or more `key: { type: ... }` entries). These are
 * candidates for `...spread` resolution. */
export function findColumnGroups(
  src: string,
): Record<string, Record<string, ColumnInfo>> {
  const groups: Record<string, Record<string, ColumnInfo>> = {};
  // const NAME = {
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1] as string;
    const openIdx = src.indexOf("{", m.index + (m[0] as string).length - 1);
    if (openIdx < 0) continue;
    // walk to matching brace
    let depth = 0;
    let close = -1;
    for (let i = openIdx; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const body = src.slice(openIdx + 1, close);
    if (!/\btype\s*:\s*["']/.test(body)) continue;
    const cols = parseColumnsObject(body, {});
    if (Object.keys(cols).length > 0) groups[name] = cols;
  }
  return groups;
}

export function parsePgSource(src: string): SourceTables {
  const tables: SourceTables = {};
  const spreads = findColumnGroups(src);

  // pgm.createTable("name", { ... })
  // pgm.addColumns("name", { ... }) / pgm.addColumn("name", { ... })
  const callRe = /pgm\.(createTable|addColumns|addColumn)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src)) !== null) {
    const fn = m[1] as string;
    const parenStart = m.index + (m[0] as string).length - 1;
    let argsText: string;
    let after: number;
    try {
      const result = readParens(src, parenStart);
      argsText = result[0];
      after = result[1];
    } catch {
      continue;
    }
    void after;

    // First arg: table name (string literal).
    const nameMatch = argsText.match(/^\s*["']([^"']+)["']\s*,/);
    if (!nameMatch) continue;
    const tableName = nameMatch[1] as string;
    // Body of second arg — find first `{` after the comma and read its
    // matching `}`.
    const restStart = (nameMatch[0] as string).length;
    const restText = argsText.slice(restStart);
    const braceIdx = restText.indexOf("{");
    if (braceIdx < 0) continue;
    let depth = 0;
    let close = -1;
    for (let i = braceIdx; i < restText.length; i++) {
      if (restText[i] === "{") depth++;
      else if (restText[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const body = restText.slice(braceIdx + 1, close);

    const newCols = parseColumnsObject(body, spreads);
    if (!tables[tableName]) tables[tableName] = {};
    if (fn === "createTable") {
      tables[tableName] = { ...tables[tableName], ...newCols };
    } else {
      // addColumns / addColumn
      tables[tableName] = { ...tables[tableName], ...newCols };
    }
  }

  return tables;
}

export function parsePgMigrations(dir: string): SourceTables {
  if (!fs.existsSync(dir)) return {};
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".cjs") || f.endsWith(".js"))
    .sort();
  const concatenated = files
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
  return parsePgSource(concatenated);
}
