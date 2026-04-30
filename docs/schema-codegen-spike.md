# Schema codegen spike (PREVENT-6 / calmly-agv.6)

## Problem

Calmly carries the **same domain shape** in three independent sources:

1. **Zod schemas** in `shared/src/model/*.ts` (e.g. `task.ts`, `user.ts`, `inbox.ts`, `settings.ts`) — runtime validation + `z.infer` types used by IPC, sync, and server handlers.
2. **SQLite DDL** in `desktop/src/main/db/migrations/*.sql` — STRICT tables with CHECK enums, partial indexes, FTS5 (`0002_fts.sql`), `unixepoch()*1000` defaults.
3. **Postgres DDL** via `node-pg-migrate` in `server/migrations/*.cjs` — JSONB columns, `gen_random_uuid()`, BIGSERIAL `sync_version`, monotonic `version` per row, deferrable constraints.

The recent post-crash audit (`calmly-3py`) found two P0 bugs (`calmly-3py.1`, `.4`) that were *pure* drift between these sources — a column existed in one place and not another. PREVENT-3 (schema-parity CI test) and PREVENT-5 (path gate: migrations PRs must touch `shared/`) catch many of these, but they are *detectors* layered on top of three hand-edited sources. They do not eliminate the underlying duplication. PREVENT-6 asks whether a single source of truth is worth the migration cost.

## Approach options

### Option A: Drizzle ORM as source of truth

- Schema lives in `shared/src/db/schema.ts` with Drizzle's typed builders.
- `drizzle-kit generate` produces SQL migrations per dialect (SQLite + PG).
- `drizzle-zod` produces zod schemas; the existing files in `shared/src/model/` get regenerated or replaced.

**Pros / Cons (this codebase):**

- Drizzle has separate `sqliteTable` and `pgTable` builders. We would still maintain **two** parallel definitions because of `STRICT` SQLite, JSONB-vs-TEXT, `unixepoch()*1000` defaults, and Postgres `BIGSERIAL` for `sync_version`. The "single source" would in practice be a thin shared definition + per-dialect overrides.
- `drizzle-zod` gives us schemas back, but our zod files include cross-field refinements (e.g. `TaskSchema.refine(...)` for the scheduled_start/end pair) that drizzle-zod cannot generate. We'd keep the refinements in a wrapping layer.
- FTS5 virtual tables (`CREATE VIRTUAL TABLE ... USING fts5(...)`) are not first-class in drizzle-kit. We'd write them as raw SQL alongside, splitting the source of truth again.
- The desktop migration runner (`desktop/src/main/db/migrations.ts`) uses `import.meta.glob` + a custom `_meta_migrations` table inside a `better-sqlite3` transaction. drizzle-kit ships its own runner with its own metadata table; either we adopt drizzle's runner and rewrite `migrations.ts`, or we run drizzle-kit only in `--print` mode and feed SQL through our existing runner. Both work, both cost time.
- 5 server migrations + 8 desktop migrations exist. Drizzle's `generate from existing` workflow imports baseline, but the cleanest path is "freeze current schemas as `0000_baseline`, write new schemas in drizzle going forward" — meaning the existing `.cjs` and `.sql` files stay, and we own a fourth shape during the transition.

**Migration cost:** ~30–50 hours. Schema porting (~12h), per-dialect divergence handling (~8h), runner integration in `desktop/src/main/db/migrations.ts` and `server/package.json`'s `migrate` script (~6h), regenerating 11 zod schemas and re-adding refinements (~6h), testing parity vs current DB (~8h), CI updates (~2h).

### Option B: Kysely + custom codegen

- Keep migrations hand-written. Use `kysely-codegen` to introspect a live SQLite + PG and emit TS types. Write a shim that converts those types to zod via a small generator.

**Pros / Cons:**

- Doesn't solve the migration drift — still three hand-edited sources. Only solves *type* drift between DB and TS, which is largely what zod schemas already do.
- Adds a build step (spin up DB → introspect → emit). Brittle on Windows (the dev env here per repo signals). No FTS5/JSON dialect win.
- Effort buys us very little our zod schemas don't already give us.

**Migration cost:** ~20 hours, mostly wasted vs the alternatives.

### Option C: Status quo + small codegen on top

- Keep zod schemas in `shared/src/model/` as the human-edited source.
- Add `tools/schema-gen/` that, when a shared model file changes, emits a **draft** SQL migration (SQLite) and a **draft** `pgm.createTable/addColumn` (`.cjs`) for human acceptance.
- Generator never auto-applies. PREVENT-3 still runs; this is upstream assistance, not enforcement.

**Pros / Cons:**

- Zero rewrite of existing migrations. Generator is opt-in.
- The hard parts (FTS5, partial indexes, CHECK constraints, sync columns) are exactly what'd require manual edits anyway. The generator handles the boring 80% (column adds, type maps).
- Risks producing drafts confidently wrong on edge cases; humans must always review. That's tolerable because PREVENT-3 catches drift regardless.
- Building it well is non-trivial — needs a TS AST walker over `shared/src/model/*.ts` (we already need one for PREVENT-3, so amortized cost).

**Migration cost:** ~10–15 hours, can share infrastructure with `tools/schema-parity/check.ts` from PREVENT-3.

### Option D: Stay status quo, lean on PREVENT-3 + PREVENT-5 gates

- No new tooling. Three sources stay. PREVENT-3 detects drift; PREVENT-5 forces the trio to be touched together.

**Pros / Cons:**

- Zero engineering cost beyond what's already planned.
- Honest read of the audit: both P0 drift bugs would have been caught by PREVENT-3's column-presence check. We don't have evidence that *type-level* or *constraint-level* drift bugs are common — and codegen wouldn't help with the FTS5/JSON/STRICT divergences anyway, since those *legitimately* differ per dialect.
- Doesn't help with future drift modes a parity check can't see (e.g., enum value drift inside a JSON column, semantic mismatches).

**Migration cost:** 0.

## Specific incompatibilities to consider

- **FTS5 virtual tables** (`0002_fts.sql`): SQLite-only. Drizzle has no first-class builder; would be raw SQL. Codegen options can't help — they'd skip these. Status quo ties.
- **JSON columns**: Postgres uses `jsonb` (`escalation_json`, `raw_json`, `suggestion_json`, `settings_json`); SQLite uses `TEXT NOT NULL CHECK (json_valid(...))`. Drizzle's `pgTable` and `sqliteTable` express this naturally with separate column types — but it's still two declarations. Codegen would need a "JSON" abstraction that maps to each.
- **Sync trio (`version`, `deleted_at`, `updated_at`)**: `calmly-3py.18` will add to all 9 sync tables in `shared/src/sync/types.ts`. Drizzle: a reusable `syncColumns` mixin works cleanly. Codegen Option C: a single helper in the generator. Status quo: hand-add to 9 tables × 3 sources = 27 edits per change (the exact pain).
- **node-pg-migrate has 5 existing migrations** (incl. server-only auth migration `0002_auth.cjs` with `users`, `magic_link_tokens`, `sessions`). Drizzle-kit doesn't ingest these; it'd generate a baseline from the current DB or we keep `node-pg-migrate` for legacy and use Drizzle for new work. Either path leaves us with two migration tools on the server for months.
- **`CREATE TABLE IF NOT EXISTS` patterns**: actually rare in our migrations — only `0002_fts.sql` uses it. The runner in `desktop/src/main/db/migrations.ts` already guarantees idempotency via `_meta_migrations`. Drizzle's runner uses a different metadata table (`__drizzle_migrations`); switching means either re-applying baseline or hand-stitching the metadata. Doable but fiddly.
- **STRICT tables**: SQLite-specific. drizzle-orm's sqlite builder supports it via table options. Codegen Option C: just emit `STRICT` literally.
- **Row defaults like `(unixepoch() * 1000)`**: expressible in Drizzle as `default(sql\`...\`)`. Trivial.

## Recommendation

**Option D — stay status quo, lean on PREVENT-3 + PREVENT-5 gates.** Defer reconsideration until either (a) the schema stabilizes near 1.0 and we want a build-time guarantee, or (b) we observe a drift bug that PREVENT-3 cannot catch.

The repo is small (8 SQLite migrations, 5 PG migrations, 11 zod schemas) and pre-1.0; the cost of any single-source approach (30–50h for Drizzle, even 10–15h for Option C) buys us a *modest* improvement over what PREVENT-3 + PREVENT-5 already deliver for free as part of the prevention epic. Both P0 drift bugs from `calmly-3py` were column-presence drift, exactly what PREVENT-3 detects. The dialect divergences we genuinely care about (FTS5, JSONB-vs-TEXT, STRICT, partial indexes, sync sequences) are precisely the cases where a "single source of truth" devolves into two definitions with a thin shared façade — buying complexity, not removing it.

The honest failure mode of "stay" is that PREVENT-3 cannot catch *semantic* drift inside JSON columns (e.g., the shape inside `settings_json` divergence between desktop and server consumers), nor enum-value drift between zod `z.enum([...])` and DB `CHECK` constraints written from memory. Those are real but rare, and easier to address with targeted unit tests than a schema rewrite.

## If "stay", what we accept

- **Manual sync of the trio** (`version`, `deleted_at`, `updated_at`) across `shared/src/model/`, desktop SQLite migrations, and server PG migrations. PREVENT-3 catches column-presence drift. PREVENT-5 forces the model file to be touched alongside any migration.
- **Enum value drift** inside `CHECK (col IN ('a','b'))` vs `z.enum(['a','b'])`. PREVENT-3 should be extended to compare enum literals (not just column names) — file as follow-up.
- **JSON column shape drift** (e.g. `settings_json` schema). PREVENT-3 cannot see inside JSON. Mitigation: zod schemas for the JSON payloads (some already exist; e.g. `JsonStringSchema` in `common.ts`) and unit tests that assert round-trip.
- **Per-dialect quirks** (FTS5, JSONB, STRICT, `unixepoch()*1000`, BIGSERIAL `sync_version`) stay hand-managed. This is unavoidable in any option.

## Follow-up

- **Title:** "PREVENT-3 follow-up: extend schema-parity check to compare enum literals between zod and CHECK constraints"
- **Type:** task
- **Priority:** 2
- **Blockers:** depends on `calmly-agv.3` (PREVENT-3) landing first.
