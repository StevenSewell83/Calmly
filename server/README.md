# calmly-sync-server

The open-source sync server for [Calmly](https://calmly.app) — a desktop-first ADHD planning app.

Self-hosting lets you own your data entirely. The Calmly desktop app can point at any instance of this server instead of the hosted service.

## What this server does

- Magic-link authentication (no passwords)
- Append-only operation log (`/sync/push`) for offline-first desktop clients
- Pull-based sync (`/sync/pull`) for reconnecting devices
- Postgres-backed persistence with automatic migrations on startup

## What it does not do

- AI suggestions (those run locally in the desktop app or via a separate cloud key)
- Telegram bot integration (bot process is separate)
- Calendar sync (desktop-only feature)
- Crash reporting or telemetry (disabled by default in self-host mode)

## Quick start

```bash
git clone https://github.com/your-org/calmly
cd calmly
docker compose up -d
until curl -sf http://localhost:3001/health; do sleep 2; done
echo "Ready."
```

See [docs/SELF_HOSTING.md](../docs/SELF_HOSTING.md) for the complete guide.

## Configuration

All config is via environment variables. See [docs/SELF_HOSTING.md](../docs/SELF_HOSTING.md#configuration-reference) for the full reference.

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Required. PostgreSQL connection string. |
| `PORT` | `3001` | HTTP port. |
| `EMAIL_SENDER` | `console` | `console` writes emails to `DEV_MAIL_DIR`; use `resend` in production. |

## Development

```bash
# From repo root
pnpm install
pnpm --filter @calmly/server dev   # tsx watch mode
pnpm --filter @calmly/server test  # vitest
```

## License

[MIT](LICENSE)
