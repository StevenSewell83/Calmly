#!/usr/bin/env bash
# Tiny wrapper around `claude` that pins the model to sonnet.
# See claude-opus.sh for rationale on --permission-mode bypassPermissions.
exec claude --model claude-sonnet-4-6 --permission-mode bypassPermissions "$@"
