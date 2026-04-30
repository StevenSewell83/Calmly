# Recurring drift audit

A scheduled agent (`/schedule`) re-runs the same three-pronged audit that produced
`calmly-3py` and `calmly-agv` on 2026-04-30. The audit's job is to catch
compounding debt from autonomous-worker commits before it becomes hard to unwind.

Source skill: `.claude/skills/calmly-audit.md`.

## Why this exists

The 2026-04-30 audit found 22 items of drift after ~12 worker commits. The same
patterns will re-emerge as workers continue committing — duplicated helpers,
oversized files, schema drift, missing tests. The PRD prevention layer
(`calmly-agv.1` through `.6`) reduces the rate at which these emerge but does not
eliminate them. A recurring audit closes the gap: drift is bounded by the audit
interval rather than by however long it takes someone to notice.

## Cadence

**Hybrid daily + 50-commit gate**. The schedule fires every day at 22:00 UTC
(low worker activity), and the skill's first action is a pre-check — it counts
commits since the last `audit-YYYY-MM-DD` git tag and exits cleanly if fewer
than 50 commits have landed. With current worker velocity (~12 commits / day
at peak) audits land roughly every 4–5 days; quiet weeks skip silently.

Cost per run: ~3 parallel sub-agent calls × ~100k tokens each = ~300k tokens
every 1–2 weeks. Modest.

## Setup (the human runs this once)

The `/schedule` command is user-driven — Claude cannot create cloud schedules
itself. From an interactive Claude Code session in this repo:

```
/schedule
```

When prompted, choose:
- **Name**: `calmly-audit`
- **Cron**: `0 22 * * 0` (Sunday 22:00 UTC)
- **Prompt**: invoke the `calmly-audit` skill via `/calmly-audit`. The skill is
  defined at `.claude/skills/calmly-audit.md` and ships with the repo, so any
  scheduled agent that pulls latest `main` can resolve it.
- **Repository**: this repo (`Calmly`).
- **Branch**: `main`.

Confirm the schedule exists with `/schedule list`. The first run is a useful
dry-run — invoke `/calmly-audit` manually before committing to the cadence.

## What it produces

1. A new bd epic — title `REFACTOR-EPIC: Audit YYYY-MM-DD — drift cleanup`
   (label `audit-YYYY-MM-DD`).
2. 5–25 children, each with file:line citations, severity, and a one-paragraph
   "what to do".
3. A new git tag on `main`: `audit-YYYY-MM-DD`. The next run uses this as its
   cursor for the commit-count pre-check.
4. A PR comment on the human's most-recent open PR (or a fresh tracking issue
   if none) with severity counts + link to the new epic.
5. `bd sync` at the end.

## How to read the findings

The new epic's children land in your normal `bd ready` queue. Treat them like
any other beads — claim, fix, close. The prevention gates (ESLint max-lines,
schema-parity, e2e on every PR, migrations-touch-shared) should mean each new
batch is materially smaller than the last; if a category keeps growing, the
gate isn't working and that's a separate bd issue.

## Disabling / pausing

- `/schedule pause calmly-audit` — temporary pause, schedule stays in place.
- `/schedule delete calmly-audit` — permanent removal.
- Commit `audit-disabled` to the repo description — the skill's pre-check
  honors this as a kill-switch (TODO: actually wire this into the skill if a
  long pause becomes likely).

## Failure modes

- **The skill files duplicates of already-known issues.** Mitigation: § "Synthesis
  rules" in the skill cross-references against existing `audit-*` labeled beads
  and drops matches before filing. If duplicates still slip through, tighten
  the matching heuristic in the skill.
- **The skill misses a category.** The three sub-agent prompts are the audit's
  recall surface. Update them when a new failure mode appears (e.g., add a
  category for AI-prompt drift once Anthropic SDK code lands).
- **The schedule silently stops running.** `/schedule list` shows last run
  time; check it monthly. Or rely on the PR comment / tracking issue to
  notice absence.

## Tracked under

- `calmly-agv.7` (PREVENT-7) — this doc + skill is the deliverable.
- Source audit: `calmly-3py` (REFACTOR-EPIC: Post-crash audit cleanup).
- Prevention layer: `calmly-agv` (PREVENTION-EPIC).
