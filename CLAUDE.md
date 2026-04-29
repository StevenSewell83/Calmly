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
