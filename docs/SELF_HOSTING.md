# Self-Hosting Calmly Sync

Calmly's sync server is open-source and can be self-hosted. This guide walks you from `git clone` to completing a full capture-to-review loop against your own server.

## Prerequisites

- Docker and Docker Compose v2
- The Calmly desktop app (download from releases, or build from source)

## Quick start

```bash
git clone https://github.com/your-org/calmly
cd calmly

# Start Postgres + sync server
docker compose up -d

# Wait for /health to return 200 (usually < 15s)
until curl -sf http://localhost:3001/health; do sleep 2; done
echo "Server ready."
```

The server is now running at `http://localhost:3001`.

## Configure the desktop app

1. Open Calmly preferences (Cmd/Ctrl + ,)
2. Under **Sync** → **Server URL**, enter `http://localhost:3001`
3. Restart the app

## Sign in

Because you are running with `EMAIL_SENDER=console`, magic-link emails are written to `/tmp/calmly-mail/` inside the server container instead of being sent:

```bash
# Request a magic link
curl -s -X POST http://localhost:3001/auth/magic-link/request \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com"}'

# Find the link in the latest email file
docker exec calmly-server sh -c 'cat $(ls -t /tmp/calmly-mail/*.html | head -1)' \
  | grep -oP 'calmly://auth/callback\?token=[^"&]+'
```

Copy the `calmly://auth/callback?token=...` URL and open it (e.g. `open <url>` on macOS or paste into your browser).

## Verify the loop

Once signed in, the desktop app syncs to your local server. Run a quick test:

```bash
# 1. Capture an item
# 2. Triage → Task → Today
# 3. Schedule in Plan
# 4. Start Focus → mark done
# 5. Review → carry forward / done
```

Or use the smoke-test script:

```bash
bash scripts/oss-smoke-test.sh
```

## Configuration reference

All configuration is passed via environment variables. The `docker-compose.yml` covers sensible defaults; override by editing the file or creating a `.env` next to it.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `PORT` | `3001` | HTTP port the server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `EMAIL_SENDER` | `console` | `console` (writes to `DEV_MAIL_DIR`) or `resend` |
| `DEV_MAIL_DIR` | `/tmp/calmly-mail` | Directory for console-mode email files |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`) |

## Production checklist

- [ ] Replace `console` email sender with `resend` and set `RESEND_API_KEY`
- [ ] Use a strong `POSTGRES_PASSWORD` and restrict `DATABASE_URL` to a dedicated user
- [ ] Put the server behind a TLS-terminating reverse proxy (nginx, Caddy, Traefik)
- [ ] Mount a persistent volume for `DEV_MAIL_DIR` if you want email history (or disable it in prod)
- [ ] Set `LOG_LEVEL=warn` in production to reduce noise

## Upgrading

```bash
git pull
docker compose build server
docker compose up -d server
```

Migrations run automatically on startup.

## Troubleshooting

**`/health` times out:** Check `docker compose logs server` — usually a database connection error. Verify Postgres is healthy: `docker compose ps`.

**Magic-link not appearing:** Run `docker exec calmly-server ls /tmp/calmly-mail/` to confirm files are being written. If empty, check `EMAIL_SENDER=console` is set.

**Sync not working:** Confirm the desktop's Server URL matches `http://localhost:3001` (or your custom address). Check the app's developer console for sync errors.
