# Build & Test Commands

The repo is in pre-scaffold state — most of these commands will not exist until
`calmly-2g1.1` (pnpm monorepo scaffolding) lands. This file is updated as
infrastructure comes online.

## Bootstrap

```bash
# After F-01 (calmly-2g1.1) lands:
pnpm install
```

## Per-workspace

```bash
# Desktop (Electron + React + Vite) — exists after F-02 (calmly-2g1.2)
pnpm --filter desktop dev
pnpm --filter desktop build
pnpm --filter desktop test

# Server (Fastify + Postgres) — exists after F-07 (calmly-2g1.7)
pnpm --filter server dev
pnpm --filter server test

# Shared types — exists after F-01
pnpm --filter shared build
```

## Quality gates (run before closing a bead that touched code)

```bash
pnpm typecheck     # all workspaces
pnpm lint          # all workspaces
pnpm test          # all workspaces
```

## Beads workflow

```bash
bd sync            # pull/push bead state via git
bd ready           # list unblocked work
bd show <id>       # detailed view incl. dependencies
bd update <id> --status=in_progress
bd close <id>
```

## Notes for the autonomous loop

- The `.ralph/` directory is per-worktree. Don't touch the other worker's `.ralph/`.
- The `.beads/` directory is shared via git — `bd sync` is your contract with the other worker.
- If a build/test command listed above fails because the workspace doesn't exist yet, it means the prerequisite bead hasn't landed; check `bd show` for the bead's blockers.

## Established primitives — use these, don't reinvent

This list grows as the audit-2026-04-30 refactor beads (`calmly-3py.*`) close.
Before writing a new helper, **grep this section** plus the file paths it
points to. If something belongs here but isn't listed, either it hasn't
landed yet (check `bd show calmly-3py`) or this section is stale — fix it.

UI (renderer):
- _Page state shell_ — pending: `<PageStateView state={...} ready={...} />`
  to replace inline `LoadingShell` + `FailureNotice` (lands with
  `calmly-3py.8`). Use existing `LoadingShell` + `FailureNotice` from the
  page that introduced them until then; do **not** copy them into a new
  file.
- _Resource hook_ — pending: `useResource(fetcher, deps)` (lands with
  `calmly-3py.8`).
- _Time formatting_ — pending: `formatRelative(when, now?)`,
  `formatClock(when, opts?)` will live in
  `desktop/src/renderer/utils/time.ts` (lands with `calmly-3py.15`). Until
  then, reuse the implementation already in the renderer; do not copy it.
- _Snooze helpers_ — pending: `snoozeOneHour`,
  `snoozeTomorrowMorning`, `snoozeNextWeek` will move to
  `desktop/src/renderer/utils/snooze.ts` (lands with `calmly-3py.17`).

IPC (main):
- _Authed handler_ — pending: `defineAuthedHandler(channel, schema, fn)`
  in `desktop/src/main/ipc/handler.ts` (lands with `calmly-3py.13`). All
  new IPC handlers will use this. Local `isStringId()` and inline payload
  validation are forbidden once it lands.
- _Task row helpers_ — pending: `loadTask`, `enqueueTaskUpsert`,
  `TaskRow`, `SCHEDULABLE_STATUSES` in `desktop/src/main/tasks/repo.ts`
  (lands with `calmly-3py.5`). For now, use the helpers that exist in
  `desktop/src/main/plan/store.ts` — do not duplicate.
- _Error contract_ — pending: standard `InvalidArgs` shape (lands with
  `calmly-3py.14`). Do not invent new error codes inline; add to the
  shared error union when needed.

Types:
- All sync-replicated row types live in `@calmly/shared` or are
  re-exported from main stores via `desktop/src/preload/api-types.ts`.
  Don't redeclare row interfaces in renderer or preload.
- Status/source/role enums import from `@calmly/shared`. No literal
  unions like `"open" | "in_progress"` outside that package. ESLint will
  enforce this once `calmly-agv.2` lands.

Migrations:
- Schema columns must exist in three places at once: `shared/src/model/`,
  `desktop/src/main/db/migrations/*.sql`, `server/migrations/*.cjs`. The
  CI parity check (`pnpm schema:check`) and the path-touch gate (PREVENT-5)
  will fail PRs that diverge. Allow-listed divergences live in
  `tools/schema-parity/allow-list.json`.
