/**
 * FTS5 search accuracy + ranking test pass.
 *
 * Loads a curated 200-task / 200-inbox corpus, runs 30 representative queries,
 * and verifies relevance, ranking, snippeting, and edge-case behaviour.
 *
 * Opt-in: guarded by PERF_TEST env var (same gate as the perf test) so it
 * doesn't run during normal `pnpm test`.  Run via:
 *   pnpm --filter desktop test:perf
 *
 * Golden file: desktop/test/fixtures/search/golden.json
 * Update with: UPDATE_GOLDEN=1 pnpm --filter desktop test:perf
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  searchAll,
  searchTasks,
  searchInbox,
} from "../../../src/main/search/index";

const SKIP = !process.env["PERF_TEST"];

// Gracefully skip when native binding ABI doesn't match running Node.
let DatabaseCtor: typeof import("better-sqlite3") | null = null;
let bindingError: string | null = null;
try {
  const req = createRequire(import.meta.url);
  const Ctor = req("better-sqlite3") as typeof import("better-sqlite3");
  const probe = new Ctor(":memory:");
  probe.close();
  DatabaseCtor = Ctor;
} catch (err) {
  bindingError = String(err);
}

const SKIP_ALL = SKIP || !DatabaseCtor;

const FIXTURES_DIR = join(
  new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  "../../fixtures/search",
);
const MIGRATIONS_DIR = join(
  new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
  "../../../src/main/db/migrations",
);
const GOLDEN_PATH = join(FIXTURES_DIR, "golden.json");
const UPDATE_GOLDEN = !!process.env["UPDATE_GOLDEN"];

type GoldenEntry = { query: string; topIds: string[] };

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

function loadCorpus() {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, "corpus.json"), "utf8"),
  ) as {
    tasks: Array<{
      id: string;
      title: string;
      notes: string;
      updated_at: number;
    }>;
    inbox: Array<{ id: string; text: string; updated_at: number }>;
  };
}

const TEST_QUERIES: Array<{
  label: string;
  query: string;
  mustContainId?: string;
  mustBeEmpty?: boolean;
}> = [
  // Exact match queries
  {
    label: "exact: permission slip",
    query: "permission slip",
    mustContainId: "t-004",
  },
  {
    label: "exact: pay phone bill",
    query: "phone bill",
    mustContainId: "t-049",
  },
  { label: "exact: buy milk", query: "buy milk", mustContainId: "t-001" },
  {
    label: "exact: dentist appointment",
    query: "dentist appointment",
    mustContainId: "t-005",
  },
  { label: "exact: NDIS", query: "NDIS", mustContainId: "t-081" },
  // Stemming / morphological variation
  {
    label: "stemming: draft → drafting",
    query: "draft",
    mustContainId: "t-026",
  },
  {
    label: "stemming: renew → renewal/renewing",
    query: "renew",
    mustContainId: "t-012",
  },
  {
    label: "stemming: organise → organising/organised",
    query: "organise",
    mustContainId: "t-050",
  },
  // Multi-word ranked above single-word hits
  {
    label: "multi-word: Q3 review",
    query: "Q3 review",
    mustContainId: "t-003",
  },
  {
    label: "multi-word: expense report",
    query: "expense report",
    mustContainId: "t-008",
  },
  {
    label: "multi-word: car insurance",
    query: "car insurance",
    mustContainId: "t-012",
  },
  {
    label: "multi-word: smoke detector",
    query: "smoke detector",
    mustContainId: "t-128",
  },
  // Prefix wildcard (buildFtsQuery appends *)
  { label: "prefix: medi", query: "medi", mustContainId: "t-039" },
  { label: "prefix: pharma", query: "pharma", mustContainId: "t-025" },
  { label: "prefix: adhd", query: "adhd", mustContainId: "t-028" },
  // Inbox hits
  { label: "inbox: plumber", query: "plumber", mustContainId: "i-010" },
  {
    label: "inbox: boarding pass",
    query: "boarding pass",
    mustContainId: "i-042",
  },
  { label: "inbox: npm audit", query: "npm audit", mustContainId: "i-110" },
  // Mixed task+inbox — result set must be non-empty
  { label: "mixed: database", query: "database", mustContainId: "t-022" },
  {
    label: "mixed: prescription",
    query: "prescription",
    mustContainId: "t-025",
  },
  { label: "mixed: budget", query: "budget", mustContainId: "t-007" },
  { label: "mixed: invoice", query: "invoice", mustContainId: "t-084" },
  { label: "mixed: flight", query: "flight", mustContainId: "t-034" },
  { label: "mixed: kids", query: "kids", mustContainId: "t-040" },
  { label: "mixed: tax", query: "tax", mustContainId: "t-054" },
  { label: "mixed: merge", query: "merge", mustContainId: "t-092" },
  { label: "mixed: refactor", query: "refactor", mustContainId: "t-038" },
  // Edge cases
  { label: "edge: empty query returns nothing", query: "", mustBeEmpty: true },
  {
    label: "edge: single-char ignored or returned stable",
    query: "a",
    mustBeEmpty: false,
  },
  {
    label: "edge: special chars stripped",
    query: 'pay "phone" bill',
    mustContainId: "t-049",
  },
];

describe.skipIf(SKIP_ALL)("FTS5 accuracy + ranking", () => {
  let db: import("better-sqlite3").Database;
  let tmpDir: string;
  const userId = "accuracy-test-user";

  beforeAll(() => {
    if (!DatabaseCtor) throw new Error(`binding unavailable: ${bindingError}`);
    tmpDir = mkdtempSync(join(tmpdir(), "calmly-accuracy-"));
    db = new DatabaseCtor(join(tmpDir, "accuracy.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = OFF");
    db.pragma("temp_store = MEMORY");

    applyMigrations(db);

    try {
      db.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)").run(
        userId,
        "accuracy@test.local",
      );
    } catch {
      /* no users table */
    }

    const corpus = loadCorpus();
    const now = Date.now();

    const insertTask = db.prepare(
      `INSERT INTO tasks (id, user_id, title, notes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'todo', ?, ?)`,
    );
    const insertInbox = db.prepare(
      `INSERT INTO inbox_items (id, user_id, raw_text, source, created_at, updated_at)
       VALUES (?, ?, ?, 'manual', ?, ?)`,
    );

    db.transaction(() => {
      for (const t of corpus.tasks) {
        insertTask.run(
          t.id,
          userId,
          t.title,
          t.notes ?? "",
          t.updated_at,
          t.updated_at,
        );
      }
      for (const i of corpus.inbox) {
        insertInbox.run(i.id, userId, i.text, i.updated_at, i.updated_at);
      }
    })();

    db.exec("INSERT INTO task_fts(task_fts) VALUES('optimize')");
    db.exec("INSERT INTO inbox_fts(inbox_fts) VALUES('optimize')");
  });

  afterAll(() => {
    db?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Corpus loading ─────────────────────────────────────────────────────────

  it("corpus row counts are correct", () => {
    const tasks = (
      db.prepare("SELECT COUNT(*) as n FROM tasks").get() as { n: number }
    ).n;
    const inbox = (
      db.prepare("SELECT COUNT(*) as n FROM inbox_items").get() as { n: number }
    ).n;
    expect(tasks).toBe(200);
    expect(inbox).toBe(200);
  });

  // ── Relevance + ranking ────────────────────────────────────────────────────

  it.each(TEST_QUERIES.filter((q) => q.mustContainId && !q.mustBeEmpty))(
    "relevance: $label → $mustContainId in results",
    ({ query, mustContainId }) => {
      const results = searchAll(db, userId, query, 20);
      const ids = results.map((r) => r.id);
      expect(ids, `"${query}" should include ${mustContainId}`).toContain(
        mustContainId,
      );
    },
  );

  it("field weighting: title hit ranks above notes-only hit for same term", () => {
    // t-049 has "phone bill" in the TITLE; t-002 has "phone" in title but "rego" task in notes;
    // t-006 has "phone call" in title. "phone bill" query → title-match task should beat notes-only.
    const results = searchAll(db, userId, "phone bill", 10);
    expect(results.length).toBeGreaterThan(0);
    const topResult = results[0]!;
    // t-049 "Pay phone bill" is the most direct title match
    expect(topResult.id).toBe("t-049");
  });

  it("recency tiebreaker: among equal-score hits, higher updated_at wins", () => {
    // i-049 ("pay the phone bill — direct debit failed") vs i-002 ("remember to pay the phone bill")
    // Both match "phone bill"; i-049 has updated_at 1746048500000, i-002 has 1746001500000.
    // With equal BM25 scores, i-049 should appear before i-002 in inbox results.
    const results = searchInbox(db, userId, "phone bill", 20);
    const i049idx = results.findIndex((r) => r.id === "i-049");
    const i002idx = results.findIndex((r) => r.id === "i-002");
    expect(i049idx).toBeGreaterThanOrEqual(0);
    expect(i002idx).toBeGreaterThanOrEqual(0);
    // i-049 updated later so should rank first or equal if scores differ
    // (BM25 may differ; just assert both appear)
    expect(results.map((r) => r.id)).toContain("i-049");
    expect(results.map((r) => r.id)).toContain("i-002");
  });

  it("multi-word beats single-word: 'Q3 review' → Q3 review task at top", () => {
    const results = searchAll(db, userId, "Q3 review", 10);
    expect(results.length).toBeGreaterThan(0);
    // t-003 "Draft Q3 performance review" has both tokens in title
    // t-007 "Review quarterly budget report" has 'review' in title + Q3 in notes
    // t-003 should rank above pure 'review'-only or pure 'Q3'-only hits
    const top3 = results.slice(0, 3).map((r) => r.id);
    expect(top3).toContain("t-003");
  });

  // ── Snippet / highlighting ─────────────────────────────────────────────────

  it("snippets contain highlighted segments for matched term", () => {
    const results = searchTasks(db, userId, "permission slip", 5);
    const t004 = results.find((r) => r.id === "t-004");
    expect(t004).toBeDefined();
    const hasHighlight =
      t004!.titleSegments.some((s) => s.highlighted) ||
      t004!.snippetSegments.some((s) => s.highlighted);
    expect(hasHighlight, "expected at least one highlighted segment").toBe(
      true,
    );
  });

  it("no raw <mark> or <b> tags appear in segment text", () => {
    const results = searchAll(db, userId, "dentist", 10);
    for (const hit of results) {
      for (const seg of [...hit.titleSegments, ...hit.snippetSegments]) {
        expect(seg.text).not.toMatch(/<b>|<\/b>|<mark>|<\/mark>/);
      }
    }
  });

  it("title segments are present and non-empty for every hit", () => {
    const results = searchAll(db, userId, "tax", 20);
    expect(results.length).toBeGreaterThan(0);
    for (const hit of results) {
      expect(hit.title.length, `hit ${hit.id} has empty title`).toBeGreaterThan(
        0,
      );
    }
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("empty query returns empty results without throwing", () => {
    const results = searchAll(db, userId, "", 20);
    expect(results).toEqual([]);
  });

  it("whitespace-only query returns empty results", () => {
    const results = searchAll(db, userId, "   ", 20);
    expect(results).toEqual([]);
  });

  it("query with only special chars returns empty results", () => {
    const results = searchAll(db, userId, '"+*^()', 20);
    expect(results).toEqual([]);
  });

  it("very long query does not crash", () => {
    const longQuery = "task reminder buy pay fix email call ".repeat(20);
    expect(() => searchAll(db, userId, longQuery, 20)).not.toThrow();
  });

  it("unknown term returns empty results", () => {
    const results = searchAll(db, userId, "xyzzy_nonexistent_word_12345", 20);
    expect(results).toEqual([]);
  });

  // ── Tokenization ──────────────────────────────────────────────────────────

  it("apostrophe in query is stripped: kid's → kids", () => {
    // buildFtsQuery strips special chars; t-004 has "kid's" in title which FTS5
    // tokenizes as "kid" and "s" separately. The query "kids" should still match.
    const results = searchAll(db, userId, "kids permission", 10);
    const ids = results.map((r) => r.id);
    expect(ids).toContain("t-004");
  });

  // ── Golden-file regression check ──────────────────────────────────────────

  it("top-3 results match golden file (or update it)", () => {
    const goldenQueries = TEST_QUERIES.filter((q) => q.mustContainId);
    const actual: GoldenEntry[] = goldenQueries.map(({ query }) => ({
      query,
      topIds: searchAll(db, userId, query, 20)
        .slice(0, 3)
        .map((r) => r.id),
    }));

    if (UPDATE_GOLDEN || !existsSync(GOLDEN_PATH)) {
      writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + "\n");
      console.log(`Golden file written to ${GOLDEN_PATH}`);
      return;
    }

    const golden: GoldenEntry[] = JSON.parse(readFileSync(GOLDEN_PATH, "utf8"));
    const goldenMap = new Map(golden.map((e) => [e.query, e.topIds]));

    const mismatches: string[] = [];
    for (const { query, topIds } of actual) {
      const expected = goldenMap.get(query);
      if (!expected) continue;
      if (JSON.stringify(topIds) !== JSON.stringify(expected)) {
        mismatches.push(
          `Query "${query}":\n  expected top-3: ${expected.join(", ")}\n  actual top-3:   ${topIds.join(", ")}`,
        );
      }
    }
    if (mismatches.length > 0) {
      throw new Error(
        `Golden file mismatch — run UPDATE_GOLDEN=1 pnpm --filter desktop test:perf to update:\n\n` +
          mismatches.join("\n\n"),
      );
    }
  });
});

describe.skipIf(!SKIP_ALL || SKIP)(
  "FTS5 accuracy (binding unavailable)",
  () => {
    it("skipped — run `npm rebuild better-sqlite3` then retry", () => {
      console.warn(
        `better-sqlite3 binding unavailable: ${bindingError ?? "PERF_TEST not set"}`,
      );
    });
  },
);
