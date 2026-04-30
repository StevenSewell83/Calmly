/**
 * Regex parser for the Zod schemas in `shared/src/model`. Each schema is
 * declared as `export const FooSchema = z.object({ ... })` and the
 * properties follow the conventional `name: z.<base>()...` shape.
 *
 * Type-bucket inference looks at the leading `z.<call>` token of each
 * value. We only need to distinguish string / number / boolean / json /
 * unknown — fine-grained zod constraints (`.min()`, `.uuid()`) are
 * irrelevant to schema parity.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { ColumnInfo, ColumnTypeBucket, SourceTables } from "./types";

/** Schema-name → table-name mapping. Convention: `XSchema` → snake_case
 * plural, with a few hand-curated overrides. Update this constant when a
 * new domain table is introduced. */
const SCHEMA_TO_TABLE: Record<string, string> = {
  TaskSchema: "tasks",
  UserSchema: "users",
  UserSettingsSchema: "user_settings",
  InboxItemSchema: "inbox_items",
  CalendarEventSchema: "events",
  ReminderRuleSchema: "reminder_rules",
  RecurrenceRuleSchema: "recurrence_rules",
  CalendarEventImportSchema: "calendar_event_imports",
  AiSuggestionSchema: "ai_suggestions",
  TelegramLinkSchema: "telegram_links",
  FocusSessionSchema: "focus_sessions",
  DailyReflectionSchema: "daily_reflections",
};

function bucketForZodCall(zodToken: string): ColumnTypeBucket {
  // zodToken is e.g. `z.string`, `z.number`, `unixMs`, `uuid`, `z.union`,
  // `JsonStringSchema`, `TaskStatusSchema`, ...
  const t = zodToken.trim();
  if (/^z\.string\b/.test(t)) return "string";
  if (/^z\.number\b/.test(t)) return "number";
  if (/^z\.boolean\b/.test(t)) return "boolean";
  if (/^z\.bigint\b/.test(t)) return "number";
  if (/^z\.enum\b/.test(t)) return "string";
  if (/^z\.literal\b/.test(t)) return "string";
  if (/^z\.union\b/.test(t)) return "unknown";
  if (/^z\.array\b/.test(t)) return "json";
  if (/^z\.object\b/.test(t)) return "json";
  if (/^z\.record\b/.test(t)) return "json";
  // Common project-specific schema aliases — these come from common.ts.
  if (/^uuid\b/.test(t)) return "string";
  if (/^unixMs\b/.test(t)) return "number";
  if (/^Json/.test(t)) return "json";
  // Anything else ending in `Schema` is one of our enum-like aliases or a
  // sub-object schema — assume string-bucket which matches the common case
  // (the *Schema enums in common.ts are all z.enum of strings).
  if (/Schema$/.test(t)) return "string";
  return "unknown";
}

/** Walk to the matching close-paren for a call starting at `(` index. */
function readParens(src: string, openIdx: number): [string, number] {
  if (src[openIdx] !== "(") throw new Error("expected '('");
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i] as string;
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
      if (depth === 0) return [src.slice(openIdx + 1, i), i + 1];
    }
  }
  throw new Error("unbalanced parens in zod schema");
}

/** Split a zod-object body on top-level commas, ignoring strings. */
export function splitZodEntries(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let buf = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (inString) {
      buf += ch;
      if (ch === "\\" && i + 1 < body.length) {
        buf += body[i + 1];
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
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      if (buf.trim()) out.push(buf.trim());
      buf = "";
      continue;
    }
    // Skip line comments inside the body.
    if (ch === "/" && body[i + 1] === "/") {
      while (i < body.length && body[i] !== "\n") i++;
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

export function parseZodObjectBody(body: string): Record<string, ColumnInfo> {
  const cols: Record<string, ColumnInfo> = {};
  for (const entry of splitZodEntries(body)) {
    // Strip leading line-comment lines before the colon-key.
    const cleaned = entry
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n")
      .trim();
    if (!cleaned) continue;

    // `name: <expr>` — captures property name and the rest of the chain.
    const m = cleaned.match(/^([A-Za-z_][\w]*)\s*:\s*([\s\S]+)$/);
    if (!m) continue;
    const colName = m[1] as string;
    const valuePart = (m[2] as string).trim();

    // The leading token (up to `(` or `.`) determines the bucket.
    const head = valuePart.match(/^([A-Za-z_$][\w.$]*)/)?.[1] ?? "";
    const bucket = bucketForZodCall(head);
    // Loose nullable detection — `.nullable()` somewhere in the chain.
    const nullable = /\.nullable\s*\(\s*\)/.test(valuePart);

    cols[colName] = {
      bucket,
      rawType: head,
      nullable,
    };
  }
  return cols;
}

export function parseZodSource(
  src: string,
): Record<string, Record<string, ColumnInfo>> {
  const out: Record<string, Record<string, ColumnInfo>> = {};
  // Match `export const NameSchema = z.object(` and read the args parens.
  const re = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*z\s*\.\s*object\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const schemaName = m[1] as string;
    const parenIdx = src.indexOf("(", m.index + (m[0] as string).length - 1);
    if (parenIdx < 0) continue;
    let argsText: string;
    try {
      argsText = readParens(src, parenIdx)[0];
    } catch {
      continue;
    }
    // The first argument is an object literal `{ ... }`.
    const braceIdx = argsText.indexOf("{");
    if (braceIdx < 0) continue;
    let depth = 0;
    let close = -1;
    for (let i = braceIdx; i < argsText.length; i++) {
      if (argsText[i] === "{") depth++;
      else if (argsText[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close < 0) continue;
    const body = argsText.slice(braceIdx + 1, close);
    out[schemaName] = parseZodObjectBody(body);
  }
  return out;
}

export function parseZodModels(dir: string): SourceTables {
  if (!fs.existsSync(dir)) return {};
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
  const tables: SourceTables = {};
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), "utf8");
    const schemas = parseZodSource(src);
    for (const [schemaName, cols] of Object.entries(schemas)) {
      const tableName = SCHEMA_TO_TABLE[schemaName];
      if (!tableName) continue; // ignore non-domain schemas (e.g. AI request DTOs)
      tables[tableName] = { ...(tables[tableName] ?? {}), ...cols };
    }
  }
  return tables;
}

export const SCHEMA_TO_TABLE_MAP: Readonly<Record<string, string>> =
  SCHEMA_TO_TABLE;
