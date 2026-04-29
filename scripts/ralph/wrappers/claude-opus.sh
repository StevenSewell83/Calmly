#!/usr/bin/env bash
# Tiny wrapper around `claude` that pins the model to opus.
# Used as CLAUDE_CODE_CMD by scripts/ralph/start-opus.sh because ralph treats
# CLAUDE_CODE_CMD as a single executable path (no arg splitting).
#
# --permission-mode bypassPermissions: the worker runs unattended in an
# isolated worktree with PR-mode merge gating, so prompting for tool
# approval would just halt the loop. Safety comes from worktree isolation
# + the user reviewing the branch via PR before merging to main.
exec claude --model claude-opus-4-7 --permission-mode bypassPermissions "$@"
