#!/usr/bin/env bash
# Periodically rebase ralph/opus and ralph/sonnet onto origin/main, then
# push the worker branches to origin so the user can review via PR/diff.
# Runs every MERGE_INTERVAL_SECONDS (default 600s = 10min).
#
# PR mode (current): worker branches publish to origin. User merges manually
# via `gh pr create` or direct review. No auto-fast-forward to main.
#
# `git rebase --autostash` handles the runtime files ralph writes between
# loops (.call_count, PROMPT.md edits, etc.) so the rebase doesn't abort.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
INTERVAL="${MERGE_INTERVAL_SECONDS:-600}"
LOG="$REPO_ROOT/.ralph/merge-loop.log"
mkdir -p "$(dirname "$LOG")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"
}

publish_branch() {
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

  git -C "$wt_path" fetch origin main --quiet || { log "[$branch] fetch failed"; return 0; }

  if git -C "$wt_path" rebase --autostash origin/main; then
    log "[$branch] rebased onto origin/main"
  else
    git -C "$wt_path" rebase --abort 2>/dev/null || true
    log "[$branch] CONFLICT during rebase — left as-is, needs manual resolution"
    return 0
  fi

  # Force-with-lease: history rewrite is intentional (we rebased), but refuse
  # to overwrite if someone else pushed to the branch since we last fetched.
  if git -C "$wt_path" push --force-with-lease origin "$branch" 2>>"$LOG"; then
    log "[$branch] pushed to origin/$branch (review via gh pr create or diff)"
  else
    log "[$branch] push failed — see log above"
  fi
}

log "merge-loop starting (interval=${INTERVAL}s, mode=PR)"
while true; do
  publish_branch ralph/opus
  publish_branch ralph/sonnet
  bd sync >/dev/null 2>&1 && log "bd sync ok" || log "bd sync failed"
  sleep "$INTERVAL"
done
