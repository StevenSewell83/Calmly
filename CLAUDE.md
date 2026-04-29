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
