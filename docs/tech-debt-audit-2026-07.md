# Technical Debt Audit — July 2026

Full-codebase review for refactoring opportunities and technical debt.
Scope: `desktop/` (main + preload + renderer), `server/`, `shared/`, `tools/`,
`oss-sync/`, root config and CI. ~44k LOC of TypeScript across 7 workspaces.

Context: a prior post-crash refactor sweep (REFACTOR-AUDIT epic, `calmly-94x`
era) already landed 220+ issues, so the codebase is in good shape overall —
strict TS everywhere, near-zero `any`/`@ts-ignore`, parameterized SQL, gated
CI. This audit focuses on what that sweep left behind, what has drifted since,
and a handful of live bugs found while verifying.

Suggested follow-up: file the items below as `bd` issues (the `bd` CLI was not
available in the audit environment). Proposed titles are given per item.

---

## 1. Broken right now (verified by running the code)

### 1.1 `@calmly/shared` unit test fails — CI unit-test job is red

`shared/src/model/__tests__/schemas.test.ts:416` ("UserSettingsSchema accepts
a valid JSON blob") does not pass the now-required `id` field, so
`UserSettingsSchema.parse` throws. `id` was added to the schema as part of the
user_settings sync fix (BUG-AUDIT-1 / migration `0009_user_settings_id`) but
this test was never updated. CI runs `pnpm -r test` (ci.yml `test` job), so
this fails the pipeline.

- Fix: add `id` to the test fixture (one line).
- Proposed issue: `BUG: shared schemas.test.ts UserSettingsSchema fixture missing required id — breaks pnpm -r test` (P1)

### 1.2 Gated typecheck passes green when `tsc` doesn't run at all

`tools/typecheck-baseline/check.ts` spawns `pnpm -r typecheck` and parses the
output for `error TS\d+` lines, but **never checks the child exit status**. If
a workspace can't even start compiling (missing node_modules, tsx/tsc not
found, pnpm crash), zero error lines are parsed and the gate reports
`0 error(s)` and exits 0. Verified live in this audit: with desktop deps
missing, `pnpm typecheck:gated` printed `0 errors` and "prune 4 baseline
entries" — all four of which are in desktop files that were never compiled.

This is the repo's primary type gate (CI `typecheck` job), so a broken build
environment silently reads as green.

- Fix: in `check.ts`, fail (exit 2) when `tc.status !== 0` **and** zero TS
  errors were parsed — that combination means the typecheck itself failed to
  run. Distinguish "tsc reported errors" from "tsc never ran".
- Proposed issue: `BUG: typecheck-baseline reports 0 errors / exit 0 when tsc fails to launch (false-green gate)` (P1)

### 1.3 Server has a live duplicate migration number `0009`

`server/migrations/0009_calendar_event_imports_account_id.cjs` and
`server/migrations/0009_telemetry_events.cjs` share a prefix. node-pg-migrate
orders lexicographically so it happens to resolve today, but this is the exact
class of collision that took desktop down (the P0 fixed in `848761e`), now
reproduced on the server side — and there is still **no guard on either side**
preventing recurrence:

- `desktop/src/main/db/migrations.ts` (`loadMigrations`) happily loads two
  migrations with the same version; the failure surfaces later as a cryptic
  `UNIQUE constraint failed: _meta_migrations.version` at app boot.
- No CI check asserts unique numeric prefixes in either migrations directory.

- Fix: renumber `0009_telemetry_events` → `0012`; add a duplicate-version
  throw in `loadMigrations` with a descriptive message; add a trivial CI step
  (or unit test) asserting unique prefixes in both migration dirs. Then close
  stale P0 `calmly-wv9`, whose desktop-side symptom no longer exists.
- Proposed issues:
  - `BUG: server migrations 0009 duplicated (calendar_event_imports vs telemetry_events)` (P1)
  - `PREVENTION: duplicate-migration-version guard in loader + CI for desktop and server` (P2)
  - Close `calmly-wv9` as fixed-by-848761e.

### 1.4 Sync push backoff never actually backs off (desktop)

`desktop/src/main/sync/loop.ts:43-48` computes readiness as
`created_at + backoffDelayMs(attempts) <= now`. `op_queue` has no
`last_attempted_at` column and `markAttempted` only bumps `attempts`, so once
an op is older than the 60s backoff cap it is *always* ready — a persistently
failing op retries on every tick forever, and with no jitter
(`sync/backoff.ts`) failing batches retry in lockstep against the server.

- Fix: migration adding `op_queue.last_attempted_at`; set it in
  `markAttempted`; compute readiness from it; add ±20% jitter.
- Proposed issue: `BUG: sync backoff computed from created_at — degrades to constant retry, no jitter` (P1)

---

## 2. High-impact refactors

### 2.1 `desktop/src/preload/api-types.ts` (702 lines) — hand-mirrored IPC contract with no drift guard

The largest file in the repo hand-duplicates the result unions defined in
`desktop/src/main/ipc/*.ts` (its own comments say "Mirrors the … union from
main/inbox/store"). It is double-exempted in `eslint.config.mjs` (max-lines
off at ~:232, banned-literal off at ~:207) with TODOs referencing beads
(`calmly-3py.6`) that are already **closed** while the exemptions live on.
`tools/schema-parity` checks only zod↔SQLite↔pg column parity — the
preload↔main dimension has **no automated guard**, which is precisely the
drift class that produced the two P0s the schema-parity tool was built for.

- Fix (either):
  1. Import the unions directly from `../main/ipc/*` (it already imports
     `../main/wireTypes`) and delete the copies; or
  2. Generate the file from the main-process types / extend schema-parity to
     assert `PreloadX ≡ IpcX` structurally.
- Then remove both eslint exemptions.
- Proposed issue: `REFACTOR: derive preload/api-types.ts from main IPC types — kill 700-line hand-mirror + stale eslint exemptions` (P1)

### 2.2 Store mutation boilerplate duplicated ~15× across desktop main stores

`plan/store.ts`, `focus/store.ts`, `inbox/store.ts`, `reminders/store.ts`,
`triage/store.ts`, `review/store.ts` all repeat the same skeleton: `try { let
found=false; const tx = db.transaction(() => {...; found=true}); tx(); return
found ? ok : NotFound } catch { return InternalError }`. The closure-mutation
dance is error-prone (`focus/store.ts:142-145` documents a TS-narrowing
workaround it forces) and every `catch {}` swallows the real error (see 2.4).
`triage/store.ts` (451 lines) is the worst case: its four resolve functions
are ~80% structural copies.

- Fix: one `withOwnedMutation(db, load, body): Result` helper owning the
  transaction, found/NotFound mapping, and catch→InternalError translation
  (with logging). Follows the precedent of `tasks/repo.ts` from
  REFACTOR-AUDIT-1. Unlocks 2.4 and shrinks triage/store well under 300 lines.
- Proposed issue: `REFACTOR: extract withOwnedMutation() — kill 15× transaction/found/catch boilerplate in main stores` (P2)

### 2.3 Server: built-but-unwired subsystems (voice pipeline, scrubbing logger)

- **Voice/transcription**: `telegram/files.ts`, all of `transcription/*`, and
  `telegram/handlers/voiceReplies.ts` are complete, tested, and reachable
  only from their own tests — `telegram/dispatcher.ts` routes `/start` only.
  Dead at runtime, but carries env surface (`OPENAI_TRANSCRIPTION_KEY` etc.).
- **Scrub logger, both sides**: `server/src/logging/index.ts`
  (`createServerLogger`) wraps pino with `@calmly/shared` `scrub()` but is
  never wired into `buildApp` — routes log through raw pino, so the
  credential-redaction defense is inert beyond pino's static `redact` keys.
  Desktop mirrors this: `createDesktopLogger` is wired only in `index.ts`;
  stores/search/`ipc/handler.ts:57` use bare `console.*` or `catch {}`
  (e.g. `search/index.ts:108-110` returns `[]` on any FTS failure, silently).

- Fix: wire a voice branch into `dispatchUpdate` (it's the product's headline
  Telegram feature per the PRD) or quarantine the modules + drop the env vars
  until scheduled; decorate the Fastify app with `createServerLogger`; expose
  the desktop logger as a singleton and log in `authedHandler` and store
  catch blocks.
- Proposed issues:
  - `FEATURE/REFACTOR: wire voice pipeline into Telegram dispatcher (or quarantine as experimental)` (P2)
  - `REFACTOR: route server + desktop error paths through the scrubbing loggers — stop console.* and silent catch {}` (P2)

### 2.4 Server: no expiry cleanup for auth/oauth tables; plaintext provider tokens

Only `oauth_states` has a sweeper. `magic_link_tokens` (also scanned live for
rate-limiting — the table grows and the rate-limit query slows forever),
`sessions`, `oauth_tickets`, and `telegram_linking_codes` are never purged.
Worst interaction: abandoned `oauth_tickets` rows retain **plaintext**
provider refresh/access tokens (`migrations/0007` text columns) indefinitely.

- Fix: generalize `sweepExpiredOauthStates` into a periodic sweeper across all
  four tables; encrypt ticket token columns (an HMAC secret,
  `OAUTH_TICKET_SECRET`, already exists to derive from) or rely on prompt
  sweeping to bound the plaintext window.
- Proposed issue: `SECURITY/REFACTOR: expiry sweeper for magic_link_tokens/sessions/oauth_tickets/linking_codes + encrypt ticket tokens at rest` (P1)

### 2.5 Renderer: `Triage.tsx` (958 lines) god-component + unfinished PageStateView migration

- `pages/Inbox/Triage.tsx` holds the queue cursor, per-item form state, three
  submit paths, a 60-line keyboard router, snooze/AI panels, 8 presentational
  subcomponents and 5 date helpers. Decompose into `useTriageQueue` /
  `useTriageForm` / `useTriageActions` / `useTriageKeyboard` hooks + sibling
  component files; target a ~150-line shell. (The eslint max-lines exemption
  references closed bead `calmly-3py.7` — reconcile.)
- The `useResource`/`PageStateView` migration (REFACTOR-AUDIT-4) stopped
  halfway: `pages/Review/Review.tsx:40-99`, `pages/Focus/useFocusSession.ts`,
  and the Settings pages (Calendar, Ai, AIUsagePanel, Privacy), QuickPlan and
  AdHocStart still hand-roll loading/error state; Settings pages have no
  signed-out handling at all.
- Proposed issues:
  - `REFACTOR: split Triage.tsx into hooks + subcomponents (~150-line shell)` (P2)
  - `REFACTOR: finish PageStateView/useResource migration — Review, Focus, Settings pages` (P2)

---

## 3. Medium-impact findings

| # | Area | Finding | Suggested fix |
|---|------|---------|----------------|
| M1 | desktop main | `inbox_items` full-snapshot `enqueueOp` payload copy-pasted 4× (`inbox/store.ts` ×3, `triage/store.ts:109`) | `enqueueInboxUpsert()` mirroring `tasks/repo.ts`'s `enqueueTaskUpsert` |
| M2 | desktop main | IPC input validation hand-rolled per handler with redundant post-guard casts (`ipc/plan.ts:74-100`, `ipc/triage.ts:29-93`); server validates the same shapes with zod | Validate IPC payloads with the shared zod schemas / small combinators |
| M3 | desktop main | Task SELECT column list duplicated & diverging: `plan/store.ts:33`, `review/store.ts:24`, vs `tasks/repo.ts:32` | Single canonical `TASK_COLS` in `tasks/repo.ts` |
| M4 | renderer | Modal pattern re-implemented ~7× with 3 different escape-key wirings, drifting z-index/backdrop, mostly no focus trap | One `<Modal>` primitive owning backdrop, aria, `useEscapeKey`, focus |
| M5 | renderer | `aiEnabled` fetched independently in 4 components (never resyncs on toggle); `ai.run` → `as` cast glue duplicated 5× with zero runtime validation of AI output | `useAiEnabled()` store-backed hook; generalize `useAiTriage` into `useAiRun<T>(op, validate)` with zod validation |
| M6 | renderer | Silent IPC write failures: dominant pattern is `if (r.ok) {…}` with no else (snooze/skip/persistSchedule etc.) | Thin `invoke()` wrapper with standardized error surface |
| M7 | server | Config read in 4 places; `telegram/config.ts`, `transcription/index.ts`, `routes/crash.ts:53` bypass the central zod `ConfigSchema`, failing at first use instead of boot | Fold into central schema, pass typed slices |
| M8 | server | Integration-test bootstrap (~40-50 lines: container, migrations, cookie minting) copy-pasted verbatim in 4 test files | `test-utils/pgContainer.ts` with `withTestServer()` |
| M9 | server | Magic-link redeem duplicated between POST & GET handlers (`auth/routes.ts:124-141` vs `159-179`) — security-sensitive path with two copies (see also open `calmly-fs7`, which wants the GET to 302 to `calmly://`) | Extract `finishRedeem()`; fix `calmly-fs7` in the same change |
| M10 | server/shared | `CalendarAccountStatus` union drift: `oauth/calendarAccounts.ts:16` lacks `reauth_required` that the DB CHECK and `connectRoutes.ts:193` have | One shared union in `@calmly/shared` |
| M11 | tooling | Type-aware ESLint rules disabled repo-wide — `no-floating-promises`/`no-misused-promises` never run in an app whose core is an async sync loop | Scoped type-aware config for `desktop/src/main/sync/**` + `server/src/**` |
| M12 | tooling | 6 grandfathered type errors in `typecheck-baseline/baseline.json`, all in the sync layer (`sync/client.ts`, `sync/loop.ts`) + a test; none has a `reason` field | Fix all 6 (one sitting), empty the baseline, keep the gate as a ratchet |
| M13 | deps | `testcontainers` split across majors (10.x desktop / 11.x server, both in lockfile); scattered caret ranges (notably `@anthropic-ai/sdk ^0.92.0` on a 0.x line) vs the repo's exact-pin norm | Converge on testcontainers 11; exact-pin the stragglers |
| M14 | deps/infra | `@electron/node-gyp` resolved as a raw GitHub tarball (`codeload.github.com/...`) — unpinnable by the registry, breaks installs in restricted-network environments (verified here), supply-chain smell | Pin via registry package or vendored override if possible |

## 4. Low-impact / hygiene

- **Dead code (verified)**: `desktop/src/renderer/pages/Review.tsx` (stub
  shadowing the real `pages/Review/Review.tsx` that the router imports) and
  `pages/Home/StubModal.tsx` (imported nowhere). Delete both. Server:
  `auth/tokens.ts:13` `tokensMatch` is test-only.
- **Stubbed live routes**: Settings/Telegram, Shortcuts, Appearance, Reminders
  render `PagePlaceholder` but are routed and visible — hide or ship.
- **`ipc/handler.ts:58`**: the sole `as unknown as` in main — widen the
  generic to include the framework error shape.
- **`search/query.ts`**: `buildFtsQuery` header comment claims a stricter
  strip than the regex performs (`:`, leading `-`, AND/OR/NOT survive);
  align comment or tighten regex — the recent FTS5 quoting P0 argues for
  tightening.
- **Server error responses**: three envelope styles (`{error}`, `{ok:false,…}`,
  capitalized `Unauthorized`) and mixed `reply.code/status`; small
  `sendError()` helper. Also `req.sessionUser!` non-null assertions in
  sync/linking routes vs explicit re-checks in oauth routes.
- **Sync protocol**: no wire protocol-version field in push/pull envelopes
  (matters once desktop and server version independently); `getMaxVersion`
  runs a 9-table UNION ALL after every push when `maxAccepted` /
  `sync_version.last_value` would do; Telegram webhook has no `update_id`
  dedup (fine while only `/start`, revisit when voice lands).
- **oss-sync**: live (self-host smoke in CI), but has no tsconfig/typecheck —
  its spec isn't type-checked against `@calmly/shared`. Add a minimal
  tsconfig + script.
- **Package naming**: server is `calmly-sync-server`, everything else is
  `@calmly/*` — rename for `--filter` predictability.
- **`GUI_draft.ts`**: correctly quarantined from tsc/eslint/prettier but reads
  like source at repo root; consider `docs/design/GUI_draft.tsx.reference`.
  (Note: CLAUDE.md references it by root path — update together.)
- **Renderer misc**: `setTimeout` toast flags without unmount cleanup
  (Settings/Ai, Settings/Calendar); `useFocusSession` start/switch duplicate
  source-derivation; non-routed modals (QuickPlan, AdHocStart, pickers)
  living under `pages/`.
- **Enum parity**: `tools/schema-parity` can't compare `z.enum` literals vs
  SQLite `CHECK (col IN (...))` — the documented follow-up from
  `docs/schema-codegen-spike.md:97`. (The spike's "stay on hand-written +
  parity gates" decision is sound; this is the one missing dimension.)

## 5. What's healthy (no action)

Strict TS (`strict`, `noUncheckedIndexedAccess`) uniform across workspaces;
zero `@ts-ignore`/`as any` in production source; parameterized SQL and
transactional sync push with isolated LWW logic; careful OAuth ticket
redemption (atomic claim, HMAC bound, constant-time compare); clean shared
barrel; keyed lists and sensible memoization in the renderer; CI enforcing
typecheck-gate, lint, format, unit + e2e, schema-parity, and a
migrations-touch-shared path gate; only one TODO comment in the entire source
tree.

## 6. Suggested sequencing

1. **Now (small, unblock CI/trust):** §1.1 test fixture, §1.2 gate
   false-green, §1.3 server migration renumber + loader guard, close
   `calmly-wv9`, delete dead files.
2. **Next (correctness):** §1.4 backoff, §2.4 sweeper + token encryption,
   M12 baseline zero-out, M10 status union.
3. **Then (leverage refactors, in this order — each unlocks the next):**
   §2.2 `withOwnedMutation` → §2.3 logger wiring → M1/M3 repo helpers;
   §2.1 api-types derivation; §2.5 Triage split + PageStateView completion;
   M4/M5/M6 renderer primitives.
4. **Opportunistic:** M7-M9, M11, M13-M14, §4 hygiene.
