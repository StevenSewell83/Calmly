#!/usr/bin/env bash
# Run one opus worker iteration loop in the foreground.
# Intended to be invoked by start-all.sh inside a tmux pane, or directly for
# debugging.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
REPO_NAME="$(basename "$REPO_ROOT")"
WT="$PARENT_DIR/$REPO_NAME-ralph-opus"

if [ ! -d "$WT" ]; then
  echo "ERROR: opus worktree not found at $WT. Run scripts/ralph/setup.sh first." >&2
  exit 1
fi

# Override the model. Ralph treats CLAUDE_CODE_CMD as a single executable
# (no arg-splitting), so we point it at a wrapper script that exec's
# `claude --model claude-opus-4-7`. The wrapper lives in the main repo, not
# the worktree, because all worktrees share the same model-tiering logic.
export CLAUDE_CODE_CMD="$REPO_ROOT/scripts/ralph/wrappers/claude-opus.sh"

cd "$WT"
echo "[opus] worktree: $WT"
echo "[opus] model:    claude-opus-4-7"
echo "[opus] starting ralph loop (Ctrl+C to stop)"
# --no-continue: both workers share ~/.claude/, so ralph's session-resume
# logic can grab the *other* worker's session ID. Disable continuity to
# force a fresh claude session each iteration.
exec ralph --no-continue --calls 30 --timeout 30 --backup --live
