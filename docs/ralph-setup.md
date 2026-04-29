# Ralph autonomous loop — setup

Two parallel workers driving the build from the bd queue:

| Worker | Model | Bead bucket | Worktree | Branch |
|---|---|---|---|---|
| opus   | `claude-opus-4-7`   | P0, P1       | `../Calmly-ralph-opus`   | `ralph/opus`   |
| sonnet | `claude-sonnet-4-6` | P2, P3, P4   | `../Calmly-ralph-sonnet` | `ralph/sonnet` |

A merge loop rebases each worker's branch onto `main` every 10 minutes and fast-forwards `main`.

## What this repo provides

Already committed and ready to use:

- `.ralphrc` — base ralph config (rate limits, allowed tools, circuit breaker)
- `.ralph/PROMPT.md` — universal rules (the worker prompts override this)
- `.ralph/AGENT.md` — build/test commands (sparse until F-01 lands)
- `.ralph/prompts/opus.md`, `.ralph/prompts/sonnet.md` — role-specific prompts
- `scripts/ralph/setup.sh` — creates the two worktrees and seeds them
- `scripts/ralph/start-opus.sh`, `start-sonnet.sh` — single-worker launchers
- `scripts/ralph/start-all.sh` — tmux launcher for both workers + merge loop
- `scripts/ralph/stop-all.sh`, `status.sh`, `merge-loop.sh`

## What you need to do (manual steps)

### 1. Install ralph globally (one-time, per machine)

```bash
# Pick a directory outside this project
git clone https://github.com/frankbria/ralph-claude-code.git
cd ralph-claude-code
less install.sh                   # READ FIRST — it writes to your shell config
./install.sh
```

After install you should have `ralph`, `ralph-monitor`, `ralph-setup`, `ralph-import` on your PATH. Verify:

```bash
which ralph && ralph --help | head -5
```

If `ralph` is missing, add the install dir to your PATH (the installer should have done this) and reload your shell.

### 2. Verify Claude Code CLI accepts `--model`

The model-tiering depends on `claude --model <id>` working. Check:

```bash
claude --help | grep -A1 -- --model
```

If `--model` isn't a flag in your `claude` CLI, update `scripts/ralph/start-opus.sh` and `start-sonnet.sh` to use whatever your version exposes (e.g., `ANTHROPIC_MODEL=...`).

### 3. Choose a runner: backgrounded or tmux

**Recommended on Windows / Git Bash: `start-bg.sh`** — uses `nohup`, writes pid files under `.ralph/pids/`, logs to `.ralph/logs/{opus,sonnet,merge}.log`. No extra dependencies.

**Alternative: `start-all.sh`** — opens a tmux session with three panes. Requires tmux, which Git Bash doesn't ship by default. Install via WSL or msys2 pacman if you want this path.

### 4. Make sure your repo has a remote `main` branch

The merge loop assumes `origin/main` exists. From `Calmly/`:

```bash
git remote -v          # confirm an origin
git fetch origin main  # confirm main exists remotely
```

If you haven't pushed yet, do so before starting workers. Workers commit to `ralph/opus` / `ralph/sonnet` and the merge loop fast-forwards `main` from those — that flow needs a remote to push to.

### 5. Create the worktrees

From `Calmly/`:

```bash
scripts/ralph/setup.sh
```

This creates `../Calmly-ralph-opus` and `../Calmly-ralph-sonnet` adjacent to the repo. Re-running is safe — it skips existing worktrees and just refreshes the `.ralph/` templates inside them.

### 6. Set your Anthropic API key

Both workers use the `ANTHROPIC_API_KEY` from your environment. Export it (or put it in your shell init) before launching:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

### 7. Launch

**Backgrounded (recommended):**

```bash
scripts/ralph/start-bg.sh         # spawns opus + sonnet + merge detached
tail -f .ralph/logs/opus.log      # watch opus
tail -f .ralph/logs/sonnet.log    # watch sonnet
tail -f .ralph/logs/merge.log     # watch merge loop
```

**Tmux (if you have it):**

```bash
scripts/ralph/start-all.sh        # tmux session 'calmly-ralph' with 3 panes
tmux attach -t calmly-ralph       # detach with Ctrl+B then D
```

## Operating it

```bash
scripts/ralph/status.sh           # snapshot: pid file state, per-worker status.json, recent commits, bd ready
scripts/ralph/stop-bg.sh          # stop backgrounded workers (SIGTERM, then SIGKILL after 3s)
scripts/ralph/stop-all.sh         # stop tmux session
tail -f ../Calmly-ralph-opus/.ralph/logs/ralph.log
tail -f ../Calmly-ralph-sonnet/.ralph/logs/ralph.log
tail -f .ralph/merge-loop.log
```

## Cost guardrails

`.ralphrc` sets `MAX_CALLS_PER_HOUR=40` (per worker; combined ~80/hr). The launcher scripts override:

- opus: `--calls 30 --timeout 30`
- sonnet: `--calls 60 --timeout 30`

Tune in `start-opus.sh` / `start-sonnet.sh`. The circuit breaker stops a worker after 3 no-progress iterations or 4 same-error iterations.

## When something goes wrong

**Workers both claimed the same bead.** Shouldn't happen because they filter by priority bucket, but if it does, `bd update <id> --status=open --assignee=` to release one. Add the bead's id to the worker's PROMPT as a "do not claim" note temporarily.

**Rebase conflict in merge loop.** The merge loop aborts the rebase and logs to `.ralph/merge-loop.log`. The worker keeps running (its branch is unchanged); resolve manually:

```bash
cd ../Calmly-ralph-opus       # or -sonnet
git rebase origin/main        # resolve conflicts, git add, git rebase --continue
```

**Worker stuck in a loop on the same task.** Check `.ralph/status.json`. The circuit breaker should catch this; if it doesn't, `scripts/ralph/stop-all.sh`, then close or reassign the offending bead.

**Need to pause one worker but not the other.** `tmux send-keys -t calmly-ralph:workers.0 C-c` (pane 0 = opus, pane 1 = sonnet, pane 2 = merge).

## What's not yet handled

- **No PR review gate.** Commits go straight to `main` via the merge loop. If you want PR review, drop `--ff-only` from `merge-loop.sh` and instead `git push origin ralph/opus` and open PRs manually.
- **No cost cap (only rate cap).** Watch your Anthropic console.
- **Workers don't know about each other's WIP at file-level.** Bead assignment is the only coordination — if both pick beads that touch the same file, the second worker's rebase conflicts and a human resolves.
