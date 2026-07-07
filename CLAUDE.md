# Calmly

Desktop-first ADHD planning app (Electron + Telegram bot, hybrid local/cloud AI). Spec lives in `ADHD_App_PRD_AI_Revised_v2.md` — treat it as the source of truth for product decisions.

## Fast dev launch

`pnpm dev` (from repo root) starts the desktop app with `CALMLY_DEV_AUTH=stub` so it boots straight into the signed-in shell as `dev@calmly.local` — no Docker, no sync server, no magic-link round trip. The stub is gated on `!app.isPackaged`, so packaged builds always use the real auth flow. To exercise the real flow in dev (e.g. when working on auth itself), run `pnpm --filter @calmly/desktop dev` directly without the env var.

## Issue tracking: use `bd` (beads)

This project uses **bd (beads)** as the primary task tracker. Do NOT use TodoWrite, TaskCreate, or scratch markdown files for tracking work — use beads.

Run `bd prime` at the start of a session for full workflow context. Quick reference:

- `bd ready` — find unblocked work
- `bd show <id>` — view issue details (incl. blockers)
- `bd create --title="..." --type=task|bug|feature|epic --priority=2` — new issue (priority 0–4, 0=critical)
- `bd update <id> --status=in_progress` — claim before coding
- `bd close <id>` — mark complete
- `bd dep add <issue> <depends-on>` — link dependency
- `bd sync --flush-only` — export to JSONL at session end

**Workflow rule**: file or claim a beads issue *before* writing code. Close it when the change lands.

See `AGENTS.md` for the full session-close protocol.

## Skills to invoke when working tasks

Different tasks benefit from specialized skills. Invoke the relevant skill **before** starting implementation:

| Trigger | Skill |
|---|---|
| Building or refining UI / new screens / visual treatment | `frontend-design` |
| Writing Playwright E2E tests against Electron, debugging IPC, main↔renderer issues | `playwright-electron-debugger` |
| Writing or modifying code that calls the Anthropic SDK / Claude API | `claude-api` |
| Reviewing a PR | `review` |
| Security review of pending changes | `security-review` |

Many tasks have an explicit `## Skills` section in their body — that's the authoritative guidance for that task. Default to the table above when no section is present.

Design principles (PRD §4) — feed these into `frontend-design` so the visual system matches the product's anti-shame, low-cognitive-load posture: **calm, anti-shame, keyboard-first, recovery-centered, progressive disclosure, AI assistive (not dominant)**.

## UI design reference: `GUI_draft.ts`

`GUI_draft.ts` (in repo root) is the canonical visual + interaction reference for the desktop UI. Treat it as the source of truth for the look-and-feel of any new screen or component. It establishes:

- **Palette**: stone (warm grays) for surfaces/text + emerald accents for active/positive states; minimal chrome
- **Shapes**: soft rounded corners (e.g., `rounded-[1.8rem]`, `rounded-[2.5rem]`); organic, not boxy
- **Typography**: serif italic for hero headers (e.g., "Peace, Alex."); sans-serif for body; tight tracking
- **Iconography**: `lucide-react` plus the custom `MountainClimberIcon` SVG
- **Layout primitives**: kanban-style columns (Inbox / Today / This Week), drag-and-drop affordances, sidebar nav with icon scale-on-active, Brain Dump entry point
- **Motion**: subtle fade-in / slide-in on view changes, rotating quote anchors

When implementing UI tasks: open `GUI_draft.ts`, identify the matching component (Home, Kanban, sidebar, Triage view), and reuse the same Tailwind class patterns / shape language unless there's a clear reason to deviate. The `frontend-design` skill should be invoked **after** loading the draft so it works *with* the established language, not against it.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
