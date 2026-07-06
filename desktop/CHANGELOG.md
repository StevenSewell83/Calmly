# Changelog

All notable changes to the Calmly desktop app are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/).

Tags follow `desktop-v<semver>` (e.g. `desktop-v1.0.0`); `scripts/release-notes.mjs`
extracts the matching section below for the GitHub Release body.

## [Unreleased]

## [1.0.0] - Unreleased

<!--
  Date pending: set a real release date on this heading (and delete this
  comment) before tagging `desktop-v1.0.0`. Until then, release-notes.mjs
  refuses to extract this section as a guard against shipping without notes.
-->

### Added
- **Home** — Now / Next / Today view, always-visible capture bar, conditional
  Inbox/Triage card, visible Replan, Quick Plan entry point
- **Capture** — quick-add input, global hotkey, optional AI parsing of
  natural language, optional brain-dump splitting
- **Inbox / Triage** — fast classification, due-date chips, route to
  Today / This Week / Later, inline "break it down," snooze/skip, optional
  AI suggestions for type / title / date / next action
- **Plan** — day view built around imported calendar events, drag-and-drop
  scheduling, Replan, optional AI daily plan
- **Focus** — current task plus next step, soft time visibility, "I'm
  stuck" guided rescue, ad hoc focus blocks, optional AI rescue
- **Review / Daily Shutdown** — what got done, carry forward, drop / move /
  reschedule, optional one-line reflection, optional AI tomorrow-suggestion
- **Quick Plan** — morning ritual confirming today's commitments,
  reorder / drop / shrink, optional AI "Suggest my day"
- **Reminders** — Important and Soft importance levels, user-defined repeat
  intervals, delivered via linked Telegram bot with desktop notification
  fallback
- **Settings** — reminder profiles, appearance, keyboard shortcuts, data
  export, calendar connections (Google, Microsoft), Telegram linking, AI
  configuration, account
- **Search** — full-text search across tasks, inbox items, and task notes
  (SQLite FTS5)
- **AI assistance** — triage cleanup, Make Startable, brain-dump splitting,
  stuck rescue, and daily planning via hybrid local (Ollama) / cloud
  (Anthropic, OpenAI) routing
- **Calendar import** — read-only import of Google and Microsoft calendar
  events into the Plan day view
- **Telegram bot** — text capture, voice capture (transcribed to Inbox),
  `/now` command, reminder delivery with Done / Snooze / Reschedule action
  buttons, account linking via `/start <code>`
