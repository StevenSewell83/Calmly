/**
 * Schema-parity check (PREVENT-3).
 *
 * Compares column-level definitions across the three sources of truth:
 *   1. shared/src/model/*.ts        — Zod schemas (canonical TS shape)
 *   2. desktop/src/main/db/migrations/*.sql — SQLite DDL
 *   3. server/migrations/*.cjs      — node-pg-migrate JS migrations
 *
 * For each known table the union of columns is computed; any column missing
 * from one or more sources (and not allow-listed) is reported as drift and
 * the process exits 1. Loose type-bucket check (string / number / boolean /
 * json / unknown) flags shape mismatches but is intentionally permissive —
 * SQLite's affinity rules and Postgres bigint vs sqlite integer are normal.
 *
 * Run via `pnpm schema:check` (root) or `pnpm --filter @calmly/schema-parity check`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  compare,
  type ColumnInfo,
  type SourceTables,
  type ColumnTypeBucket,
} from "./lib/compare";
import { parseSqliteMigrations } from "./lib/parseSqlite";
import { parsePgMigrations } from "./lib/parsePg";
import { parseZodModels } from "./lib/parseZod";
import type { AllowList } from "./lib/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const SOURCES = {
  shared: path.join(REPO_ROOT, "shared", "src", "model"),
  desktop: path.join(REPO_ROOT, "desktop", "src", "main", "db", "migrations"),
  server: path.join(REPO_ROOT, "server", "migrations"),
};

const ALLOW_LIST_PATH = path.join(__dirname, "allow-list.json");

function readAllowList(): AllowList {
  if (!fs.existsSync(ALLOW_LIST_PATH)) return { divergences: [] };
  const raw = fs.readFileSync(ALLOW_LIST_PATH, "utf8");
  return JSON.parse(raw) as AllowList;
}

function colorize(
  s: string,
  color: "red" | "green" | "yellow" | "dim",
): string {
  if (process.env.NO_COLOR) return s;
  const codes = { red: 31, green: 32, yellow: 33, dim: 2 } as const;
  return `[${codes[color]}m${s}[0m`;
}

function summariseColumn(col: ColumnInfo | undefined): string {
  if (!col) return colorize("missing", "red");
  return `${col.bucket}${col.rawType ? ` (${col.rawType})` : ""}`;
}

function collectAllTables(sources: {
  shared: SourceTables;
  desktop: SourceTables;
  server: SourceTables;
}): string[] {
  const set = new Set<string>();
  for (const t of Object.keys(sources.shared)) set.add(t);
  for (const t of Object.keys(sources.desktop)) set.add(t);
  for (const t of Object.keys(sources.server)) set.add(t);
  return Array.from(set).sort();
}

interface RunResult {
  driftCount: number;
  silencedCount: number;
}

export function runCheck(opts: {
  shared: SourceTables;
  desktop: SourceTables;
  server: SourceTables;
  allowList: AllowList;
  log?: (line: string) => void;
}): RunResult {
  const log = opts.log ?? ((line: string) => process.stdout.write(line + "\n"));
  const tables = collectAllTables(opts);

  let driftCount = 0;
  let silencedCount = 0;

  for (const table of tables) {
    const result = compare(
      table,
      {
        shared: opts.shared[table],
        desktop: opts.desktop[table],
        server: opts.server[table],
      },
      opts.allowList,
    );
    silencedCount += result.silenced.length;

    if (result.drifts.length === 0) continue;
    driftCount += result.drifts.length;

    for (const d of result.drifts) {
      log("");
      log(colorize(`DRIFT: ${table}.${d.column}`, "red"));
      const fmt = (label: string, col: ColumnInfo | undefined) => {
        const mark = col
          ? colorize("PRESENT", "green")
          : colorize("MISSING", "red");
        log(`  ${mark} ${label.padEnd(8)} — ${summariseColumn(col)}`);
      };
      fmt("shared", d.cells.shared);
      fmt("desktop", d.cells.desktop);
      fmt("server", d.cells.server);
      if (d.kind === "type-mismatch") {
        log(
          colorize(
            `  reason: type-bucket mismatch (${d.types.join(" vs ")})`,
            "yellow",
          ),
        );
      }
    }
  }

  log("");
  if (driftCount === 0) {
    log(
      colorize(
        `schema parity OK — ${tables.length} tables checked, ${silencedCount} divergences allow-listed.`,
        "green",
      ),
    );
  } else {
    log(
      colorize(
        `schema parity FAILED — ${driftCount} drift(s) across ${tables.length} tables (${silencedCount} silenced by allow-list).`,
        "red",
      ),
    );
    log(
      colorize(
        `See tools/schema-parity/README.md for how to update the allow-list.`,
        "dim",
      ),
    );
  }

  return { driftCount, silencedCount };
}

async function main(): Promise<void> {
  const shared = parseZodModels(SOURCES.shared);
  const desktop = parseSqliteMigrations(SOURCES.desktop);
  const server = parsePgMigrations(SOURCES.server);
  const allowList = readAllowList();

  const result = runCheck({ shared, desktop, server, allowList });
  process.exit(result.driftCount === 0 ? 0 : 1);
}

// Entry-point guard — only run when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (invokedDirectly) {
  main().catch((err: unknown) => {
    process.stderr.write(`schema:check crashed: ${(err as Error).message}\n`);
    if (err instanceof Error && err.stack)
      process.stderr.write(err.stack + "\n");
    process.exit(2);
  });
}

export type { ColumnInfo, ColumnTypeBucket, SourceTables };
export { parseSqliteMigrations, parsePgMigrations, parseZodModels };
