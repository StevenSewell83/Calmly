# Calmly

Desktop-first ADHD planning app (Electron + Telegram bot, hybrid local/cloud AI). Spec lives in `ADHD_App_PRD_AI_Revised_v2.md` — treat it as the source of truth for product decisions.

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
