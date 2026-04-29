#!/usr/bin/env bash
# Periodically rebase ralph/opus and ralph/sonnet onto main, then fast-forward
# main from each. Runs every MERGE_INTERVAL_SECONDS (default 600s = 10min).
#
# This is the "auto-merge" half of the parallel-worker design: each worker
# commits to its own branch, and this loop folds those commits back into main
# so workers don't drift apart.
#
# Conflicts: if a rebase conflicts, the script aborts the rebase, logs the
# conflict, and keeps going. The user resolves manually.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
INTERVAL="${MERGE_INTERVAL_SECONDS:-600}"
LOG="$REPO_ROOT/.ralph/merge-loop.log"
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

merge_branch() {
  local branch="$1"
  local wt_path
  case "$branch" in
    ralph/opus)   wt_path="$(dirname "$REPO_ROOT")/$(basename "$REPO_ROOT")-ralph-opus" ;;
    ralph/sonnet) wt_path="$(dirname "$REPO_ROOT")/$(basename "$REPO_ROOT")-ralph-sonnet" ;;
    *) log "unknown branch $branch"; return 1 ;;
  esac

  if [ ! -d "$wt_path" ]; then
    log "[$branch] worktree missing — skipping"
    return 0
  fi

  # 1. Pull latest main (and any other workers' commits that already merged)
  git -C "$wt_path" fetch origin main --quiet || log "[$branch] fetch failed"

  # 2. Rebase the worker branch onto main. Abort cleanly on conflict.
  if git -C "$wt_path" rebase origin/main; then
    log "[$branch] rebased onto main"
  else
    git -C "$wt_path" rebase --abort 2>/dev/null || true
    log "[$branch] CONFLICT during rebase — left as-is, needs manual resolution"
    return 0
  fi

  # 3. Fast-forward main to include the worker's commits
  if git -C "$REPO_ROOT" merge --ff-only "$branch" 2>/dev/null; then
    log "[$branch] fast-forwarded main"
    git -C "$REPO_ROOT" push origin main 2>/dev/null && log "[$branch] pushed main" || log "[$branch] push deferred"
  else
    log "[$branch] main not fast-forwardable — skipping merge this cycle"
  fi
}

log "merge-loop starting (interval=${INTERVAL}s)"
while true; do
  merge_branch ralph/opus
  merge_branch ralph/sonnet
  bd sync >/dev/null 2>&1 && log "bd sync ok" || log "bd sync failed"
  sleep "$INTERVAL"
done
