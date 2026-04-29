#!/usr/bin/env bash
# Snapshot of what each worker is doing right now.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
REPO_NAME="$(basename "$REPO_ROOT")"
SESSION="calmly-ralph"

echo "=== tmux session ==="
if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux list-panes -t "$SESSION" -F "#{pane_index} #{pane_current_command} #{pane_current_path}"
else
  echo "(no '$SESSION' session)"
fi

for role in opus sonnet; do
  WT="$PARENT_DIR/$REPO_NAME-ralph-$role"
  echo
  echo "=== $role @ $WT ==="
  if [ -d "$WT" ]; then
    if [ -f "$WT/.ralph/status.json" ]; then
      cat "$WT/.ralph/status.json"
    else
      echo "(no status.json yet)"
    fi
    echo "--- last 5 commits on ralph/$role ---"
    git -C "$WT" log --oneline -5 2>/dev/null || echo "(no commits)"
  else
    echo "(worktree missing — run scripts/ralph/setup.sh)"
  fi
done

echo
echo "=== beads queue ==="
bd stats
echo
echo "=== ready work ==="
bd ready
