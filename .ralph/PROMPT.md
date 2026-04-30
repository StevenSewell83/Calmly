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

## Before you write code (anti-drift rules)

These rules exist because past workers re-created helpers, types, and
patterns that already lived elsewhere in the repo. Each is a hard rule.

1. **Grep before write.** Before creating a util, hook, helper, or row
   interface, run `Grep` for:
   - The function name you're about to write (and 2 nearby aliases)
   - The shape of the data (e.g. `interface TaskRow`, `type InboxItem`)
   - Any error code string you're about to introduce
   If a match exists, *use it* or extend it. If you find near-duplicates
   in 2+ files, that is a refactor opportunity — file a bd issue and
   stop.

2. **Use the kit.** See `.ralph/AGENT.md` § "Established primitives" for
   the canonical components/helpers. Build new pages using them. If a
   page can't use the kit, write a 1-line note in the bead explaining
   why.

3. **Schema touches all three places or none.** Any change to a
   sync-replicated column updates `shared/src/model/<x>.ts` AND the
   matching `desktop/src/main/db/migrations/*.sql` AND
   `server/migrations/*.cjs`. Diffs that touch only one will fail
   review (the migrations-touch-shared CI gate enforces this).

4. **LOC budget: 300 lines per file.** If your edit pushes a file past
   300, stop. File a "split this file" bd issue first, close it, then
   come back. (`Triage.tsx` hit 880 lines under the old rule — never
   again.) ESLint `max-lines` enforces this.

5. **Error vocabulary lives in `shared/src/errors.ts`.** Don't invent
   new error codes inline. If you need a new one, add it to the union
   there first.

6. **Ship with tests.** Every IPC handler ships with happy + auth-fail +
   bad-payload tests. Every renderer page ships with at least one e2e
   spec covering the golden path. No exceptions; if test infra is
   missing, file a P1 bead and block on it.

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
