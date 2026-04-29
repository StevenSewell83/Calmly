#!/usr/bin/env bash
# Kill the background workers started by start-bg.sh.
set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
PIDS_DIR="$REPO_ROOT/.ralph/pids"

if [ ! -d "$PIDS_DIR" ] || [ -z "$(ls -A "$PIDS_DIR" 2>/dev/null)" ]; then
  echo "No pid files in $PIDS_DIR — nothing to stop."
  exit 0
fi

for pidfile in "$PIDS_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  role="$(basename "$pidfile" .pid)"
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && echo "[$role] sent SIGTERM (pid $pid)"
    # Give it 3s, then SIGKILL if still alive
    for _ in 1 2 3; do
      sleep 1
      kill -0 "$pid" 2>/dev/null || break
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null && echo "[$role] forced SIGKILL"
  else
    echo "[$role] not running (pid $pid stale)"
  fi
  rm -f "$pidfile"
done
