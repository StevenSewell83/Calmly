# schema-parity

PREVENT-3: keep the three sources of truth for the data model in lockstep.

Sources compared:

1. **shared** — `shared/src/model/*.ts` (Zod schemas, the public DTO)
2. **desktop** — `desktop/src/main/db/migrations/*.sql` (SQLite DDL)
3. **server** — `server/migrations/*.cjs` (node-pg-migrate JS migrations)

The tool walks every column declared in any source and emits drift when a
column is missing from one or more sources (or has an obviously wrong
type bucket — string vs number vs boolean vs json) and isn't covered by
`allow-list.json`.

## Run

```bash
pnpm schema:check
```

Exit codes:

- `0` — schema parity OK
- `1` — drift detected (printed to stdout)
- `2` — tool crash

## Tests

```bash
pnpm --filter @calmly/schema-parity test
```

## Updating the allow-list

Some divergences are legitimate:

- Sync metadata (`version`, `updated_at`, `deleted_at`) lives on the wire
  but isn't part of the public DTO, so it's missing from `shared`.
- Server-only tables (`magic_link_tokens`, `sessions`) hold private auth
  state that never replicates.
- Desktop-only tables (`secrets`, `op_queue`, `sync_state`) hold local
  working state.
- `focus_sessions` is per-device and intentionally does not sync.

When you add a new legitimate divergence, append an entry to
`allow-list.json`:

```json
{
  "table": "tasks",
  "column": "estimate_minutes",
  "presentIn": ["shared", "server"],
  "absentIn": ["desktop"],
  "reason": "Server-only roll-up; desktop derives from focus_sessions."
}
```

The `reason` is required — future readers (and reviewers) need to know
why the divergence is intentional. If a reviewer can't tell from the
reason alone, the entry is too terse.

For whole-table allow-listing, use the `tables` key (same shape minus
`column`).

## How it works

- `lib/parseSqlite.ts` regex-parses `CREATE TABLE` and
  `ALTER TABLE ADD COLUMN` from concatenated migration text.
- `lib/parsePg.ts` regex-parses `pgm.createTable(...)` and
  `pgm.addColumns(...)` calls, resolving `...sync` style spreads against
  same-file `const sync = { ... }` declarations.
- `lib/parseZod.ts` regex-parses `export const NameSchema = z.object({...})`
  declarations and looks up the table name via a curated
  `SCHEMA_TO_TABLE` map.
- `lib/compare.ts` computes the union of columns per-table and reports
  drift relative to the allow-list.

The parsers are deliberately regex-based and assume the migrations follow
the established style. If a future migration deviates, add a fixture test
to `__tests__/check.test.ts` and harden the parser.
