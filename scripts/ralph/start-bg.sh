#!/usr/bin/env bash
# Background launcher (no tmux required). Spawns opus + sonnet + merge-loop
# detached, writes pid files under .ralph/pids/, redirects stdout/stderr to
# .ralph/logs/<role>.log. Safe to re-run — checks pid files.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PIDS_DIR="$REPO_ROOT/.ralph/pids"
LOGS_DIR="$REPO_ROOT/.ralph/logs"
mkdir -p "$PIDS_DIR" "$LOGS_DIR"

start_bg() {
  local role="$1"
  local script="$REPO_ROOT/scripts/ralph/$2"
  local pidfile="$PIDS_DIR/$role.pid"
  local logfile="$LOGS_DIR/$role.log"

  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then
    echo "[$role] already running (pid $(cat "$pidfile")) — log: $logfile"
    return
  fi

  rm -f "$pidfile"
  nohup bash "$script" >>"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  disown "$pid" 2>/dev/null || true
  echo "[$role] started (pid $pid) — log: $logfile"
}

start_bg opus   start-opus.sh
start_bg sonnet start-sonnet.sh
start_bg merge  merge-loop.sh

echo
echo "All three workers backgrounded. Tail logs with:"
echo "  tail -f .ralph/logs/opus.log"
echo "  tail -f .ralph/logs/sonnet.log"
echo "  tail -f .ralph/logs/merge.log"
echo
echo "Stop with: scripts/ralph/stop-bg.sh"
