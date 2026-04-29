#!/usr/bin/env bash
# Idempotent setup for the two ralph worker worktrees.
#
# Creates ../Calmly-ralph-opus and ../Calmly-ralph-sonnet, each on its own
# branch (ralph/opus, ralph/sonnet), and seeds each worktree's .ralph/ from
# the templates in this repo. Safe to re-run.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT_DIR="$(dirname "$REPO_ROOT")"
REPO_NAME="$(basename "$REPO_ROOT")"

create_worktree() {
  local role="$1"          # opus | sonnet
  local branch="ralph/$role"
  local wt_path="$PARENT_DIR/$REPO_NAME-ralph-$role"

  if [ -d "$wt_path" ]; then
    echo "[$role] worktree already exists at $wt_path — skipping create"
  else
    echo "[$role] creating worktree at $wt_path on $branch"
    if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$branch"; then
      git -C "$REPO_ROOT" worktree add "$wt_path" "$branch"
    else
      git -C "$REPO_ROOT" worktree add -b "$branch" "$wt_path"
    fi
  fi

  # Seed the worker's .ralph/ from main's templates. We rsync so re-runs pick
  # up template changes without clobbering runtime files (logs, sessions).
  echo "[$role] syncing .ralph/ templates"
  mkdir -p "$wt_path/.ralph/prompts"
  cp -f "$REPO_ROOT/.ralph/AGENT.md" "$wt_path/.ralph/AGENT.md"
  cp -f "$REPO_ROOT/.ralph/PROMPT.md" "$wt_path/.ralph/PROMPT.md.fallback"
  cp -f "$REPO_ROOT/.ralph/prompts/$role.md" "$wt_path/.ralph/PROMPT.md"
  cp -f "$REPO_ROOT/.ralph/prompts/$role.md" "$wt_path/.ralph/prompts/$role.md"
  cp -f "$REPO_ROOT/.ralphrc" "$wt_path/.ralphrc"

  echo "[$role] ready: $wt_path"
}

# Refuse to run if there are uncommitted changes — worktrees inherit the index
# state and we don't want surprises.
if ! git -C "$REPO_ROOT" diff --quiet || ! git -C "$REPO_ROOT" diff --cached --quiet; then
  echo "ERROR: uncommitted changes in $REPO_ROOT. Commit or stash before running setup." >&2
  exit 1
fi

create_worktree opus
create_worktree sonnet

echo
echo "Done. Next:"
echo "  scripts/ralph/start-all.sh    # launch both workers in tmux"
echo "  scripts/ralph/status.sh       # see what's running"
