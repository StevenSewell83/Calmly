/**
 * Search performance test — opt-in only.
 * Run via: pnpm --filter desktop test:perf
 * Skipped during normal `pnpm test` runs (guarded by PERF_TEST env var).
 *
 * Requires better-sqlite3 native bindings compiled for the running Node version.
 * If the bindings were built for Electron (a different ABI), the test is skipped
 * with a clear message. Run `npm rebuild better-sqlite3` to fix.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { searchAll } from "../../src/main/search/index";
import { seedDatabase } from "./seed";

const SKIP = !process.env["PERF_TEST"];

// Attempt to load the native binding. Skip gracefully if ABI mismatch (e.g.,
// bindings were compiled for Electron's Node, not the system Node).
let DatabaseCtor: typeof import("better-sqlite3") | null = null;
let bindingError: string | null = null;
try {
  const req = createRequire(import.meta.url);
  const Ctor = req("better-sqlite3") as typeof import("better-sqlite3");
  // Probe instantiation — the native binding loads lazily on first `new`.
  const probe = new Ctor(":memory:");
  probe.close();
  DatabaseCtor = Ctor;
} catch (err) {
  bindingError = String(err);
}

const SKIP_BINDING = SKIP || !DatabaseCtor;

const MIGRATIONS_DIR = join(
  new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  "../../src/main/db/migrations",
);

function applyMigrations(db: import("better-sqlite3").Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.exec(sql);
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

const QUERY_TOKENS = [
  "call",
  "email",
  "review",
  "fix",
  "phone",
  "bill",
  "meeting",
  "doctor",
  "report",
  "project",
  "deadline",
  "budget",
  "invoice",
  "follow up",
  "review fix",
  "phone bill",
  "urgent important",
  "call email",
  "meeting doctor",
  "deadline budget",
];

describe.skipIf(SKIP_BINDING)("Search performance (10k rows)", () => {
  let db: import("better-sqlite3").Database;
  let tmpDir: string;
  let userId: string;

  beforeAll(() => {
    if (!DatabaseCtor)
      throw new Error(`better-sqlite3 binding unavailable: ${bindingError}`);
    tmpDir = mkdtempSync(join(tmpdir(), "calmly-perf-"));
    db = new DatabaseCtor(join(tmpDir, "perf.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = OFF");
    db.pragma("temp_store = MEMORY");

    applyMigrations(db);
    userId = seedDatabase(db, 8000, 2000, 42);
    db.exec("INSERT INTO task_fts(task_fts) VALUES('optimize')");
    db.exec("INSERT INTO inbox_fts(inbox_fts) VALUES('optimize')");
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("row counts match seed (determinism check)", () => {
    const tasks = (
      db.prepare("SELECT COUNT(*) as n FROM tasks").get() as { n: number }
    ).n;
    const inbox = (
      db.prepare("SELECT COUNT(*) as n FROM inbox_items").get() as { n: number }
    ).n;
    expect(tasks).toBe(8000);
    expect(inbox).toBe(2000);
  });

  it("p50 < 20ms and p95 < 50ms across 100 queries", () => {
    const latencies: number[] = [];
    for (let i = 0; i < 100; i++) {
      const q = QUERY_TOKENS[i % QUERY_TOKENS.length]!;
      const start = performance.now();
      searchAll(db, userId, q, 20);
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p50 = percentile(latencies, 50);
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);

    console.log(`\nSearch latency distribution (ms):`);
    console.log(`  p50: ${p50.toFixed(2)}`);
    console.log(`  p95: ${p95.toFixed(2)}`);
    console.log(`  p99: ${p99.toFixed(2)}`);
    console.log(`  min: ${latencies[0]!.toFixed(2)}`);
    console.log(`  max: ${latencies[latencies.length - 1]!.toFixed(2)}`);

    expect(p50, `p50 ${p50.toFixed(1)}ms exceeds 20ms budget`).toBeLessThan(20);
    expect(p95, `p95 ${p95.toFixed(1)}ms exceeds 50ms budget`).toBeLessThan(50);
  });
});

describe.skipIf(!SKIP_BINDING || SKIP)(
  "Search performance (binding unavailable)",
  () => {
    it("skipped — run `npm rebuild better-sqlite3` then retry", () => {
      console.warn(
        `better-sqlite3 binding unavailable: ${bindingError ?? "PERF_TEST not set"}`,
      );
    });
  },
);
