#!/usr/bin/env bash
# Tiny wrapper around `claude` that pins the model to opus.
# Used as CLAUDE_CODE_CMD by scripts/ralph/start-opus.sh because ralph treats
# CLAUDE_CODE_CMD as a single executable path (no arg splitting).
exec claude --model claude-opus-4-7 "$@"
