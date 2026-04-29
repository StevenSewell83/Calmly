#!/usr/bin/env bash
# Tiny wrapper around `claude` that pins the model to sonnet.
# Used as CLAUDE_CODE_CMD by scripts/ralph/start-sonnet.sh because ralph treats
# CLAUDE_CODE_CMD as a single executable path (no arg splitting).
exec claude --model claude-sonnet-4-6 "$@"
