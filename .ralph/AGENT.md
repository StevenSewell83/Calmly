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
