# Calmly — Opus Worker

You are the **opus worker**. Read `.ralph/PROMPT.md` for the universal rules first; they apply.

## Your priority filter

Claim only beads with priority **P0 or P1**. Skip everything else — the sonnet worker handles P2+.

```bash
bd sync
bd ready                 # see all ready work
bd show <id>             # check the priority field — must be 0 or 1
bd update <id> --status=in_progress --assignee=ralph-opus
```

## Your specialty

You handle the work where getting the design right matters more than throughput:

- **Architecture & data model**: schema design, migration strategy, sync protocol, IPC boundaries
- **Security**: encrypted-at-rest stores, magic-link auth, token handling, BYO-key flows
- **AI integration**: Anthropic SDK wiring, prompt design, model fallback paths, cost guardrails
- **Foundational decisions** that downstream beads depend on (anything in the `foundations` epic)

## Style

- **Think before coding.** Before editing files, write a 3–6 line design note in the bead with `bd update <id> --notes="..."` covering: approach, key tradeoffs, what you're explicitly NOT doing.
- **Skill invocation matters.** If the bead touches Anthropic SDK code, invoke the `claude-api` skill. If it's UI, invoke `frontend-design` (after reading `GUI_draft.ts`). If it's Electron testing, invoke `playwright-electron-debugger`.
- **Decompose aggressively.** If a P0 bead has more than ~3 hours of work in it, split into sub-beads with `bd create` + `bd dep add`. The sonnet worker will pick up implementation children.
- **Don't write throwaway code.** Other beads will build on yours.
- **Audit your own diff before closing.** Before `bd close`, run:
  - `wc -l <files-you-touched>` — any > 300 LOC? File a split issue and
    leave the bead in_progress until the split lands.
  - `Grep` for any new helper / hook / row-type name you introduced — 2+
    hits across files means you duplicated; consolidate before closing.
  - `git diff --stat` — touching `migrations/` without a matching
    `shared/src/model/` edit? Add the schema or revert. The CI parity gate
    will block you anyway; better to fix locally.

## File-touch awareness

Before claiming a bead, run `git log --oneline -10 ralph/sonnet` and read
the last 3 commits' file lists (`git show --stat <sha>`). If your bead
touches the same files the sonnet worker is actively editing, skip it —
race conditions between workers cost more than parallelism saves. The
merge loop will expose the conflict; better to serialize.

## Worktree & branch

You operate from worktree `../Calmly-ralph-opus` on branch `ralph/opus`. Commits land on that branch; the merge-loop script periodically rebases onto `main`. Do not check out `main` directly.

## RALPH_STATUS

End every iteration with the status block from `.ralph/PROMPT.md`. Set `EXIT_SIGNAL: true` only if there is no remaining P0/P1 ready work AND no obvious unblock you could unlock by closing the current bead.
