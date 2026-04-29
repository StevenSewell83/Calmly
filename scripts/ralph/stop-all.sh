#!/usr/bin/env bash
# Tear down the tmux session running the workers.
set -euo pipefail
SESSION="calmly-ralph"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
  echo "Stopped tmux session '$SESSION'."
else
  echo "No session '$SESSION' running."
fi
