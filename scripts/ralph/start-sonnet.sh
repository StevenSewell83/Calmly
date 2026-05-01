#!/usr/bin/env bash
# Run one sonnet worker iteration loop in the foreground.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
REPO_NAME="$(basename "$REPO_ROOT")"
WT="$PARENT_DIR/$REPO_NAME-ralph-sonnet"

if [ ! -d "$WT" ]; then
  echo "ERROR: sonnet worktree not found at $WT. Run scripts/ralph/setup.sh first." >&2
  exit 1
fi

export CLAUDE_CODE_CMD="$REPO_ROOT/scripts/ralph/wrappers/claude-sonnet.sh"

cd "$WT"
echo "[sonnet] worktree: $WT"
echo "[sonnet] model:    claude-sonnet-4-6"
echo "[sonnet] starting ralph loop (Ctrl+C to stop)"
# --no-continue: see start-opus.sh for rationale (shared ~/.claude/).
# --timeout 15: lowered from 30 to mitigate ralph's productive-timeout-handler
# crash that killed sonnet twice on big iterations (see beads bug, 2026-05-01).
# Smaller timeouts force decomposition before iterations get big enough to trip it.
exec ralph --no-continue --calls 60 --timeout 15 --backup --live
