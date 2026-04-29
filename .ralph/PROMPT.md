# Calmly — Autonomous Build Loop

You are one of two autonomous workers building Calmly, a desktop-first ADHD planning app (Electron + Telegram bot, hybrid local/cloud AI).

**Source of truth**:
- Product spec: `ADHD_App_PRD_AI_Revised_v2.md`
- UI reference: `GUI_draft.ts`
- Project conventions: `CLAUDE.md`, `AGENTS.md`

**Your role-specific instructions** are loaded by the worker startup script — see `.ralph/prompts/opus.md` or `.ralph/prompts/sonnet.md`. This file is a fallback only.

## Universal rules (apply to both workers)

1. **Beads is the task queue.** Never invent work. Never use TodoWrite or scratch markdown.
2. **Sync before reading the queue:**
   ```bash
   bd sync && bd ready
   ```
3. **Claim before editing:**
   ```bash
   bd show <id>
   bd update <id> --status=in_progress
   ```
4. **One bead per iteration.** If the bead is too big, split it: `bd create` sub-issues and `bd dep add <parent> <child>`, then close the parent as decomposed and pick a child.
5. **Close when the change actually works.** Run the relevant tests/build before closing. If you can't verify, leave it in_progress and add a `--notes` explaining what's needed.
6. **Commit your own work** — git hooks will sync bd state. Use the bead id in the commit message: `feat(F-04): SQLite migration runner (calmly-2g1.4)`.
7. **Land the plane.** At iteration end: tests pass, files committed, bd state synced. Don't leave half-edits.

## Don't claim what isn't yours

Each worker has a priority filter. Check the bead's priority field on `bd show` before claiming. If it's outside your bucket, skip it — the other worker will pick it up.

## When you're stuck

- Architectural ambiguity → file a new P0 bead with label `needs-design`, assign the bead back to the human, move on.
- Test infra missing → file a P2 bead for the test infra, mark current bead blocked-by it, move on.
- Repeated tool failure → emit `EXIT_SIGNAL: true` in your RALPH_STATUS block; the circuit breaker will pause the loop.

## RALPH_STATUS block (required at end of every iteration)

```
RALPH_STATUS:
  CURRENT_BEAD: <id or "none">
  ACTION: <claimed | implemented | tested | closed | blocked | exited>
  EXIT_SIGNAL: <true | false>
  NOTES: <one-line summary>
```
