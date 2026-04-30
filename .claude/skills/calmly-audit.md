---
name: calmly-audit
description: Run the three-pronged Calmly drift audit and file findings to beads. Spawns parallel sub-agents over (1) desktop main, (2) renderer + e2e, (3) server + shared. Synthesizes results into a fresh `REFACTOR-EPIC` bd issue with prioritized children. Use when scheduling a recurring audit or when the user asks for a "drift audit" / "compounding-debt audit".
---

# Calmly drift audit (recurring)

This skill replays the 2026-04-30 audit that produced `calmly-3py` (REFACTOR-EPIC: Post-crash audit cleanup) and `calmly-agv` (PREVENTION-EPIC). Run it on a cadence — every 2 weeks, or after every ~50 worker commits, whichever comes first.

## When to invoke

- User invokes `/calmly-audit`
- A scheduled `/schedule` routine fires (see `docs/recurring-audit.md`)
- User asks for a "drift audit", "compounding-debt audit", or "follow-up audit"
- The merge loop has run uninterrupted for ≥ 30 commits since the last `audit-YYYY-MM-DD` git tag

Skip if there is already an open epic with label `audit-YYYY-MM-DD` for the current calendar month — otherwise this skill files duplicates.

## What it does

1. **Pre-check**: run `git rev-list --count <last-audit-tag>..HEAD`. If < 30, ask the user whether to proceed anyway.
2. **Spawn three parallel sub-agents** with the prompts in § "Sub-agent prompts" below.
3. **Synthesize** their findings: dedupe items, cross-reference against open `audit-*` labeled bd issues (use `bd list --status=open --label=audit-*`), drop anything already filed.
4. **File** a new epic and children:
   - Epic title: `REFACTOR-EPIC: Audit YYYY-MM-DD — drift cleanup`
   - Each child cites the source (file:line refs from sub-agent reports)
   - Priority follows the rubric in § "Severity rubric"
5. **Tag** main with `audit-YYYY-MM-DD` for the next run's cursor.
6. **Notify** the user via `gh pr comment` on their most-recent open PR (or open a tracking issue) with severity counts.
7. **Sync beads** via `bd sync`.

## Sub-agent prompts

Each prompt is invoked as `Agent(subagent_type="general-purpose", prompt=...)`. Run all three in parallel — single message, three Agent calls.

### Sub-agent 1: desktop main + IPC + sync
```
Audit `desktop/src/main/**` and `desktop/src/preload/**` for drift, duplication, and bug-shaped patterns. Specifically look for:

1. **Duplicated helpers** — functions or row-type interfaces that exist in 2+ files. Run Grep across the directory tree for any helper name that looks repository-internal.
2. **Files over 300 LOC** — these violate the LOC budget; report each with current line count.
3. **Inline payload validation** — IPC handlers using local `isStringId()`, raw `typeof` checks, or hand-rolled zod parses instead of `defineAuthedHandler`. List handlers that don't use it.
4. **Schema drift** — any `*.sql` migration column that has no matching field in `shared/src/model/<x>.ts`.
5. **Error contract inconsistency** — error codes returned from IPC that aren't in `shared/src/errors.ts`.
6. **Dead code** — unused exports, dead branches, abandoned half-finished features.
7. **Sync loop bugs** — confirm `before-quit` shuts down cleanly; confirm push handlers respect `version` / `deleted_at`.

Report: a numbered list of findings, each with severity (P0 bug / P0 refactor / P1 / P2), affected files (with line refs), and a one-paragraph "what to do" summary suitable for filing as a bd child issue.
```

### Sub-agent 2: renderer + e2e
```
Audit `desktop/src/renderer/**` and `desktop/e2e/**` for drift and regression risk. Specifically look for:

1. **Duplicated UI primitives** — any `LoadingShell`, `FailureNotice`, `formatRelative`, `formatClock`, snooze helper, or page-state shell that's been copy-pasted across pages. Grep for the shapes, not just names.
2. **Files over 300 LOC** — same as the main audit.
3. **Banned literal enums** — string literals like `"open" | "in_progress" | "telegram"` outside `shared/`. ESLint should already catch these once `calmly-agv.2` has landed; report any escapes.
4. **Stale e2e assertions** — Playwright specs asserting headings, route segments, or aria labels that no longer exist in the renderer. Run a quick text search to find `getByRole('heading', { name: ... })` / `getByText(...)` calls in `desktop/e2e/foundations/**` and confirm each target string still appears in renderer source.
5. **Pages without e2e** — list any new page (last 30 days of git log under `desktop/src/renderer/pages/`) that has no spec covering its golden path.
6. **Accessibility gaps** — DnD without keyboard equivalents; modals without focus traps; buttons without aria-labels.
7. **Inline async without error UI** — `useEffect(() => { await fetch... })` patterns that don't surface failure to the user.

Report format: same as sub-agent 1.
```

### Sub-agent 3: server + shared
```
Audit `server/**` and `shared/**` for drift. Specifically look for:

1. **Schema parity drift** — for every table in `shared/src/model/`, cross-reference against `server/migrations/*.cjs` and `desktop/src/main/db/migrations/*.sql`. Report any column that exists in one source but not the others (excluding entries in `tools/schema-parity/allow-list.json`).
2. **Auth bypass / rate-limit gaps** — endpoints under `server/src/routes/` that handle credential-bearing requests but bypass rate limits, omit auth checks, or duplicate logic across GET/POST handlers.
3. **`/sync/push` and `/sync/pull` integrity** — confirm push validates against per-table domain schemas (not just `SyncMeta`); confirm pull respects LIMIT and the sync trio.
4. **Duplicated zod schemas** — any shape declared in 2+ files within `shared/`.
5. **Magic-link / auth column drift** — particularly `users` table; sync trio (`version`, `deleted_at`, `updated_at`) presence on every sync-replicated table.
6. **Error vocabulary** — all server error responses use codes from `shared/src/errors.ts`.

Report format: same as sub-agent 1.
```

## Synthesis rules

After the three sub-agents return:

1. **Dedupe**: a finding flagged by multiple sub-agents counts once, with all citations merged.
2. **Cross-reference open beads**: run `bd list --status=open --json` and filter for issues whose title or description matches the finding. Drop already-filed items.
3. **Group by category**: bug, refactor, test-gap, schema-drift, security. The epic body lists these as sections.
4. **File the epic + children** using `bd create`. Use parallel sub-agents for child creation if the count is > 5.
5. **Tag main**: `git tag audit-YYYY-MM-DD && git push --tags`. Use today's date.
6. **Notify**: `gh pr list --state=open --author=@me --limit=1 --json url -q '.[0].url'` → `gh pr comment $URL --body "..."` with severity counts and a link to the new epic. If no open PR, open a tracking issue with `gh issue create`.

## Severity rubric

- **P0 bug** — production-affecting (data loss, auth bypass, sync corruption, crash on common path)
- **P0 refactor** — drift that's actively making future workers slower (duplicated helpers, oversized files blocking edits)
- **P1** — drift that doesn't compound but should be fixed before more feature work in that area
- **P2** — cleanup opportunities; low-friction-when-touched
- **P3** — research / explore / nice-to-have

## Acceptance for this skill

- The skill, when invoked, files exactly one new epic and 5–25 children.
- Children cite specific file paths.
- The audit completes in < 10 minutes wall-clock with the three sub-agents in parallel.
- Disabling: see `docs/recurring-audit.md`.
