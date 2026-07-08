# Changelog

All notable changes to `calmly-sync-server` are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-05-01

### Added

- Magic-link authentication (no passwords)
- Append-only sync protocol (`/sync/push`, `/sync/pull`)
- PostgreSQL-backed persistence with automatic migrations on startup
- Console email sender for self-host development (`EMAIL_SENDER=console`)
- Docker Compose one-command self-host setup
- Production Dockerfile (multi-stage, non-root runtime)
- OSS community files: LICENSE (MIT), README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- Migration documentation with rollback notes and backup/restore guide
- Self-hosting configuration reference (`docs/SELF_HOSTING_CONFIG.md`)
