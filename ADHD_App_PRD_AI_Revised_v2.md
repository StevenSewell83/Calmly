# PRD v2: AI-Assisted Desktop ADHD Planning App (MVP)

*Decision log baked in: 2026-04-29. Supersedes `ADHD_App_PRD_AI_Revised.md`. See §25 for the full decision recap and §26 for tensions deliberately carried forward.*

## 1. Product Summary
A desktop-first app for adults with ADHD that helps them capture thoughts, sort them into actionable items, plan the day, start tasks, recover when plans break, and close the loop at the end of the day.

The desktop app is built on **Electron** for Mac, Windows, and Linux. Mobile is delivered as a **Telegram bot** — there is no native mobile app in MVP. AI runs in **hybrid mode**: a local model via **Ollama** for lightweight tasks, and a cloud model via **Anthropic** or **OpenAI** for harder ones. Users **bring their own API key**.

The product still works without AI, without Ollama installed, and without Telegram linked. AI and external integrations enhance the workflow; they do not gate it.

## 2. Problem
Adults with ADHD often struggle less with knowing what matters than with turning intention into action. Common breakdown points:

- forgetting tasks before they are captured
- accumulating unsorted mental clutter
- struggling to turn vague tasks into startable actions
- failing to place work realistically in time
- getting stuck starting or switching tasks
- abandoning plans when the day goes off track
- ending the day with unfinished cognitive residue

Most existing tools solve only part of this loop. MVP solves the full daily loop end to end.

## 3. Target User
### Primary
- adults with ADHD or ADHD-like executive function struggles
- laptop/desktop-heavy knowledge workers
- people who need help with planning, follow-through, reminders, and recovery
- users easily overwhelmed by setup and complex systems

### Initial core persona
- late-diagnosed or self-aware adult knowledge worker
- uses desktop/laptop for cognitively demanding work
- comfortable installing a desktop app and a Telegram bot
- wants a calmer, more forgiving system than mainstream productivity tools

## 4. Product Principles
- **Low cognitive load** — reduce setup, choices, and UI clutter
- **Anti-shame** — language supports recovery, not guilt
- **Desktop-first** — the main workflow lives where the work happens
- **Keyboard-first** — fast capture and navigation are essential
- **Recovery-centered** — the app must help when the plan breaks
- **Progressive disclosure** — only show complexity when needed
- **Trustworthy** — privacy-forward and transparent
- **One core loop** — avoid fragmented mini-systems
- **AI is assistive, not mandatory** — the app remains useful and coherent without AI
- **AI reduces thinking, not adds it** — AI outputs must be short, concrete, and action-oriented
- **AI is contextual, not dominant** — main interaction is structured UI, not chat
- **AI suggestions are transparent and editable** — users can accept, edit, or ignore
- **Local where possible, cloud when chosen** — Ollama by default for cheap operations; cloud API for harder ones, gated by user's own key
- **Integrations are optional and deferred** — every external link (Telegram, Google, Microsoft, Ollama, API keys) is set up only when the user reaches the moment it helps

## 5. Core Value Proposition
Help users move through this daily loop with less friction:

**Capture → Triage → Plan → Focus → Recover → Review**

With AI enabled, AI assists at the highest-friction moments inside that same loop. The loop does not change shape based on whether AI is on.

## 6. AI Posture
### AI mode
**Hybrid**, with three sub-modes the user can pick:
- **Off** — no AI; deterministic UI only
- **Local only** — Ollama on the user's machine
- **Cloud only** — Anthropic or OpenAI via the user's API key
- **Hybrid (default when configured)** — local for fast/cheap actions, cloud for harder ones

### What AI is used for
- triage classification (type)
- title cleanup
- date/time extraction
- brain-dump splitting
- task breakdown / "Make Startable"
- "I'm stuck" rescue suggestions
- daily planning suggestions
- replan suggestions
- end-of-day / next-day suggestions

### What AI is not used for
- silently changing data without confirmation
- replacing the main UI with chat
- making hidden decisions the user cannot inspect
- any action without an undo or accept/reject step

### Failure behavior
If AI is unavailable, slow, disabled, or rejected:
- the workflow still functions
- no critical action is blocked
- the app falls back to deterministic UI
- failures surface inline with what happened and what to do

## 7. MVP Scope

### Desktop app (Electron)
1. **Home** — Now, Next, Today; always-visible capture bar; conditional Inbox/Triage card; visible Replan; Quick Plan entry point
2. **Capture** — quick-add input, global hotkey, optional AI parsing of natural language, optional brain-dump splitting
3. **Inbox / Triage** — fast classification, due-date chips, route to Today / This Week / Later, inline "break it down," snooze/skip, optional AI suggestions for type / title / date / next action
4. **Plan** — day view around imported calendar events, drag/drop, Replan, optional AI daily plan
5. **Focus** — current task + next step, soft time visibility, "I'm stuck" guided rescue, ad hoc focus blocks, optional AI rescue
6. **Review / Daily Shutdown** — what got done, carry forward, drop/move/reschedule, optional one-line reflection, optional AI tomorrow-suggestion
7. **Quick Plan** — morning ritual confirming today's commitments, reorder/drop/shrink, optional AI "Suggest my day"
8. **Reminders** — two importance levels (Important / Soft), user-defined repeat intervals, **delivered via Telegram** when linked (desktop notification fallback)
9. **Settings** — reminder profiles, appearance, keyboard shortcuts, data export, calendar connections (Google, Microsoft), Telegram linking, AI configuration, account
10. **Search** — full-text across tasks, inbox items, and task notes (SQLite FTS5)
11. **AI assistance** — triage cleanup, Make Startable, brain-dump splitting, stuck rescue + daily planning

### Mobile surface — Telegram bot
1. **Capture** — text messages → Inbox
2. **Voice capture** — voice notes transcribed via cloud API (Whisper or equivalent) → Inbox
3. **Reminder delivery** — outbound reminders pushed as bot messages with action buttons (Done / Snooze / Reschedule)
4. **Now** — `/now` command shows current task + next action
5. **Linking** — `/start <code>` flow tied to the user's account

There is no native iOS/Android app in MVP.

## 8. Out of Scope for MVP
- native mobile apps (iOS, Android)
- full autonomous agent
- chat-first assistant as the main interface
- Projects page, Notes/reference system, formal templates, life-area taxonomy
- body doubling, Apple Watch
- WhatsApp / SMS reminder channels (Telegram is the mobile reminder channel)
- two-way calendar write-back
- advanced analytics / pattern insights
- collaboration / shared tasks
- distraction blocking
- medication tracking/export
- adaptive reminder AI
- advanced energy-based planning UI
- silent AI auto-rescheduling without approval
- Smart Presets (Appointment, Birthday, Recurring chore, Follow-up)
- Apple Calendar / CalDAV
- voice capture on desktop (Telegram voice only)
- four-tier reminder profiles (only two tiers ship)

## 9. Core User Journey
### Morning
- user opens desktop app
- Quick Plan surfaces today's commitments and top items
- user triages a few captured items if needed
- user schedules or confirms today's blocks
- user may optionally use AI to suggest a realistic day

### During the day
- user captures thoughts on desktop or via Telegram (text or voice note)
- user enters Focus for a planned or ad hoc task
- if stuck, user uses guided rescue, optionally AI-assisted
- if the plan breaks, user hits Replan and adjusts
- reminders arrive via Telegram (or desktop notification if Telegram not linked)

### End of day
- user completes Daily Shutdown on desktop
- unfinished items are moved, dropped, or rescheduled
- day ends with closure, not mental spillover

## 10. Screen List

### Desktop
- Home
- Inbox / Triage
- Plan
- Focus
- Review / Shutdown
- Settings (with sub-pages: Account, Reminders, Calendar, Telegram, AI, Appearance, Shortcuts, Data)
- Search overlay

### Telegram bot
- Linking flow
- Capture (default behavior on any text/voice message)
- Reminder messages with inline action buttons
- `/now`, `/today`, `/inbox` commands

## 11. Functional Requirements

### Capture
- capture an item in under 5 seconds on desktop
- captured items go to Inbox by default
- global desktop hotkey works from anywhere
- Telegram capture: any text or voice message to the bot becomes an Inbox item
- voice notes are transcribed via cloud API; raw audio is retained until transcription succeeds, then discarded
- if AI is enabled, user can optionally invoke parse/cleanup or brain-dump split

### Triage
- process one item at a time in focused mode
- classify type, assign date via quick chips, route to Today / This Week / Later
- break a vague item into a clearer next action inline
- skip or snooze without penalty
- if AI is enabled, suggest type / date / title cleanup / next action
- all AI suggestions editable or ignorable

### Plan
- imported calendar commitments visible (Google + Microsoft 365)
- place tasks around existing commitments
- reschedule quickly
- day planning is lightweight, not project management
- if AI is enabled, may suggest top priorities, realistic load, candidate blocks, items to defer

### Focus
- one current task and one next step
- time secondary by default
- "I'm stuck" triggers guided help, one question at a time
- start focus even if nothing was pre-scheduled
- if AI is enabled, rescue suggestions tailored to current task and day state

### Replan
- available from Home, Plan, and Focus
- push, drop, shrink, or move tasks
- framed as recovery, not failure
- if AI is enabled, may suggest what to move/shrink/keep/defer

### Review
- complete shutdown in a few minutes
- unfinished tasks moved forward or dropped
- leave with a clear next-day state
- if AI is enabled, may suggest tomorrow's top item

### Reminders
- two importance levels: **Important** and **Soft**
- user defines repeat intervals per task or per profile (e.g., every 10 min until acknowledged, every 4 hours, daily)
- delivery via Telegram when bot is linked; desktop notification fallback otherwise
- reminders include inline actions (Done / Snooze 10m / Reschedule)

### Search
- full-text across tasks, inbox items, and notes
- backed by SQLite FTS5 in the local cache
- keyboard-first; ⌘/Ctrl+K opens search overlay anywhere

## 12. Onboarding Requirements
First 5 minutes — only one thing is required: **sign in via magic link**. Everything else is optional and deferred.

Suggested but not required:
- capture 3–5 items or do a brain dump
- triage 1–3 items
- schedule one item
- start one focus session or see Now state

Not part of first-run; surfaced in Settings or contextually:
- Telegram bot linking (suggested when user first wants mobile capture or reminders)
- Google or Microsoft calendar connection (suggested when user first opens Plan)
- Ollama setup (suggested when user enables Local AI mode in Settings)
- API key entry (suggested when user enables Cloud AI mode in Settings)
- AI mode selection (default Off; user opts in)

Onboarding avoids:
- long forms
- preference walls
- forced AI/integration decisions
- empty/confusing first state

## 13. Empty States and Error States

### Empty states
- first open with no items
- empty inbox
- nothing scheduled today
- no current focus task
- review with no completed items

### Error states
- calendar connection fails (Google or Microsoft)
- calendar OAuth token expired
- reminder delivery failed (Telegram offline, user blocked bot)
- voice transcription failed
- Telegram bot not linked when user expects it
- sync failed (local cache out of date)
- Ollama not running / model not pulled
- API key missing or invalid
- API call failed or timed out
- API quota exceeded for the user's key

Each state must tell the user: what happened, what they can do next, whether anything is lost.

## 14. Data Model Sketch
Core entities:

- **User** — account, magic-link auth, linked Telegram chat ID, linked calendars, AI configuration
- **InboxItem** — raw captured item before triage; resolves into Task / Event / discarded
- **Task** — actionable item; due date, status, reminder profile, parent task, source (desktop / telegram-text / telegram-voice / ai-split)
- **Event** — time-based commitment; imported from calendar or created manually
- **ReminderRule** — importance (Important / Soft), repeat interval, escalation behavior
- **RecurrenceRule** — repeating schedule for tasks/reminders
- **CalendarEventImport** — read-only external events from Google or Microsoft, with provider + external ID
- **AISuggestion** — optional metadata on a Task/InboxItem: source model, prompt class, accepted/rejected/edited
- **TelegramLink** — bot chat ID ↔ user account, with one-time linking codes
- **UserSettings** — reminder profiles, appearance, shortcuts, AI preferences (mode, provider, key references), privacy preferences

Structural notes:
- Tasks support **parent–child relationships** from day one; MVP UI exposes one level
- InboxItem converts into Task/Event or is resolved to Someday/Delete and no longer persists as InboxItem
- API keys are stored encrypted at rest, never sent to the server in plaintext

## 15. Calendar Integration
MVP scope:
- read-only import from **Google Calendar** and **Microsoft 365 Calendar**
- existing commitments appear in Plan
- the app helps the user plan around them
- OAuth via standard providers; refresh tokens stored encrypted

Not in MVP:
- creating calendar events in external calendars
- two-way sync
- Apple / iCloud / CalDAV

## 16. AI Settings
Settings → AI section:

- **AI enabled**: on / off (default off)
- **AI mode**: Off / Local only / Cloud only / Hybrid
- **Local model** — chosen from Ollama models installed on the user's machine; the app reads the local Ollama list and lets the user pick
- **Cloud provider** — Anthropic and/or OpenAI; user pastes their own API key per provider
- **Routing rules (Hybrid)** — short editable mapping of action class → local/cloud (e.g., triage = local, planning = cloud)
- **Privacy mode** — Local only / Allow cloud for selected actions
- **Suggestion behavior** — Automatic inline / On-demand only
- **Show brief reason for suggestions** — on / off
- **Speed vs quality preference**

## 17. AI Technical Posture
### Local via Ollama
Used for:
- triage classification
- title cleanup
- date extraction
- brain-dump splitting
- short stuck-help suggestions
- simple task breakdown

Behavior:
- the app does not bundle a model; the user installs Ollama and pulls a model of their choice
- if Ollama is not running, Local-only mode degrades gracefully and the UI surfaces a one-line "start Ollama" hint
- the recommended model in onboarding copy can be Gemma 2 2B, Llama 3.2 3B, or Phi-3.5 mini, but the user's choice is honored

### Cloud via Anthropic / OpenAI
Used for:
- complex breakdown
- daily planning suggestions
- nuanced replanning
- voice transcription (Whisper or provider equivalent)

Behavior:
- multi-provider: user can configure Anthropic, OpenAI, or both
- if both are configured, the user picks a default provider; per-action routing can override
- API keys are user-supplied and stored encrypted on the user's machine

### Hybrid routing
- Local handles classification, extraction, and short rewrites
- Cloud handles longer-context planning and reasoning
- Default routing is shipped; user can override

### Fallback behavior
If AI is unavailable, disabled, or rejected:
- the app remains fully usable
- AI buttons degrade to inline messages with a fix path
- no user data is lost
- deterministic workflows remain primary

## 18. Telemetry
- **Opt-in** anonymous usage telemetry, off by default
- captures: feature use counts, session length, AI suggestion accept/reject/edit rates, error types
- never captures: task content, calendar content, Telegram message content, API keys
- crash reports are separate and also opt-in
- telemetry endpoint is documented; users can inspect what is sent

## 19. Pricing and Packaging
- **Pay-once desktop license** for the core app
- **BYO API key** for cloud AI features (Anthropic and/or OpenAI)
- **Optional self-hostable sync server** — published as open source; users can run it themselves to avoid the hosted sync service
- **Hosted sync** is included with the license at launch; if hosting costs become unsustainable, a small subscription for hosted sync may be added (license remains pay-once for the desktop app)
- pricing remains transparent; no hidden AI metering — variable cost lives entirely in the user's own API account

## 20. Architecture Overview
- **Desktop app**: Electron, with a SQLite local cache (incl. FTS5 for search)
- **Backend**: hosted sync server (source of truth), Telegram bot webhook, magic-link email, calendar OAuth proxy, optional self-host build
- **Sync model**: cloud-first with local cache; offline edits queue and replay on reconnect
- **AI access**: AI calls originate on the desktop client using the user's keys (no server-side AI proxy at MVP); local AI calls go to Ollama on the user's machine

## 21. Success Criteria for MVP
### Qualitative
- users feel the app is calmer and less punishing than standard productivity tools
- users can move from capture to action without getting lost
- users feel helped when the day goes off track
- users understand AI as an assistive option, not a requirement

### Behavioral (measured via opt-in telemetry)
- user completes capture-to-review loop in one day within the first week
- AI-assisted actions are accepted often enough to indicate value (target: ≥40% accept rate on triage cleanup) without becoming mandatory
- user returns for Quick Plan and Shutdown on multiple days per week
- Telegram capture rate as a fraction of total captures (signals mobile-surface fit)

## 22. Key Risks
- scope creep across the integration surface (Google + Microsoft + Telegram + Ollama + 2 cloud providers + sync + magic-link auth)
- onboarding complexity if integrations are not properly deferred
- pay-once pricing vs. ongoing hosted-sync cost
- multi-provider AI doubling prompt-engineering and eval surface
- local model quality variance across user-chosen Ollama models
- Telegram geographic skew (weaker adoption in US) limits mobile-surface coverage for some users
- magic-link email deliverability
- calendar OAuth edge cases (token expiry, recurrence, timezones)
- model latency disrupting low-friction UX
- weak or hallucinated suggestions reducing trust

## 23. Build Order
1. **Foundations**: Electron shell, magic-link auth, SQLite local cache, server skeleton, sync protocol, basic data model
2. **Deterministic core loop**: Capture → Inbox → Triage → Plan → Focus → Review (no AI, no Telegram, no calendar)
3. **Telegram bot**: linking flow, inbound text + voice (transcription via cloud API), outbound reminder messages with action buttons
4. **Reminders engine**: two-level profiles, user-defined repeat intervals, Telegram delivery + desktop fallback
5. **Calendar**: Google first, Microsoft 365 second
6. **Search**: SQLite FTS5 across tasks/inbox/notes
7. **AI v1 (cloud-only via BYO key, single provider)**: triage cleanup, Make Startable, brain-dump splitting
8. **AI v1.1**: add Ollama local mode, second cloud provider, stuck rescue + daily planning
9. **Telemetry, onboarding polish, empty/error state passes**
10. **Self-hostable sync** packaging as an OSS release

## 24. One-Line Positioning
A pay-once, desktop-first ADHD planning app with a Telegram companion and bring-your-own-AI — built to capture, sort, schedule, start, recover, and close the day with less friction.

---

## 25. Decision Log (2026-04-29)
| Area | Decision |
|---|---|
| Platform | Electron, cross-platform |
| Mobile | Telegram bot only |
| AI mode | Hybrid (local + cloud) |
| Local AI | Any model installed via Ollama |
| Cloud AI | Multi-provider: Anthropic + OpenAI, BYO key |
| Calendar | Google + Microsoft 365 (read-only import) |
| Reminders | Two levels (Important / Soft), Telegram delivery, user-defined intervals |
| Voice capture | Telegram voice notes only (transcribed via cloud API) |
| Search | Full-text across tasks, inbox, notes (SQLite FTS5) |
| Smart presets | Deferred |
| Auth | Required account, email magic link |
| Storage | Cloud-first with local cache |
| Pricing | Pay-once + BYO API key + optional self-host sync |
| AI features | Triage cleanup, Make Startable, brain-dump split, stuck rescue + daily planning |
| Telemetry | Opt-in anonymous |

## 26. Tensions Carried Forward
These are deliberately not resolved at PRD time. Documenting them so they're visible during build.

- **Cloud-first sync vs. optional self-host.** Both are committed. Implication: the sync server must ship as a clean OSS release alongside hosted sync, which is more engineering than either path alone. Plan to defer the OSS release to step 10 of build order.
- **Pay-once vs. ongoing hosted-sync cost.** Sustainable at low scale; revisit pricing model when paying users approach the threshold where infra cost per user exceeds amortized license revenue.
- **Onboarding density.** Five external integrations (Telegram, Google, Microsoft, Ollama, two cloud AI providers) plus magic-link sign-in. Mitigation: every integration is optional and deferred to the moment of need; Settings is the only place that exposes the full surface.
- **Multi-provider AI.** Two cloud providers double prompt/eval/billing surface. Mitigation: ship one provider in step 7; add the second only in step 8 once core AI flows are stable.
- **All four AI feature classes in MVP.** Stuck rescue + daily planning are the most demanding. Mitigation: they ship in step 8, after triage/breakdown/split have validated the AI surface.
