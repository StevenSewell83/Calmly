#!/usr/bin/env bash
# Launch both ralph workers + the merge loop in a tmux session.
# Three panes: opus | sonnet | merge.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SESSION="calmly-ralph"

if ! command -v tmux >/dev/null 2>&1; then
  echo "ERROR: tmux not found. On Windows, install via Git Bash + tmux package or use WSL." >&2
  echo "Alternative: run start-opus.sh, start-sonnet.sh, and merge-loop.sh in three terminals." >&2
  exit 1
fi

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' already running. Attach with: tmux attach -t $SESSION"
  exit 0
fi

tmux new-session  -d -s "$SESSION" -n workers   "$REPO_ROOT/scripts/ralph/start-opus.sh; bash"
tmux split-window -h -t "$SESSION:workers"      "$REPO_ROOT/scripts/ralph/start-sonnet.sh; bash"
tmux split-window -v -t "$SESSION:workers.0"    "$REPO_ROOT/scripts/ralph/merge-loop.sh; bash"
tmux select-layout -t "$SESSION:workers" tiled

echo "Started tmux session '$SESSION' with three panes (opus | sonnet | merge)."
echo "Attach:  tmux attach -t $SESSION"
echo "Stop:    scripts/ralph/stop-all.sh"
