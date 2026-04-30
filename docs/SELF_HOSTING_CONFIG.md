# Self-Hosting Configuration Reference

This document covers every environment variable the Calmly sync server reads, grouped by domain, plus step-by-step setup for each external service.

## Core

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | **Required.** PostgreSQL connection string, e.g. `postgresql://user:pass@host:5432/db` |
| `PORT` | `3001` | Port the HTTP server binds to |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `production` | Set to `development` locally for pretty logs |
| `LOG_LEVEL` | `info` | Pino level: `debug`, `info`, `warn`, `error` |
| `BASE_URL` | — | Public HTTPS URL of your server (used for callback URLs), e.g. `https://sync.example.com` |

## Secrets

Generate strong random values with:

```bash
openssl rand -base64 32
```

| Variable | Description |
|---|---|
| `SESSION_SECRET` | Signs session tokens. Rotate to invalidate all sessions. |
| `MAGIC_LINK_SIGNING_SECRET` | Signs magic-link tokens. Rotate to invalidate outstanding links. |

## Email

| Variable | Default | Description |
|---|---|---|
| `EMAIL_SENDER` | `console` | `console` (dev) · `resend` (production) |
| `DEV_MAIL_DIR` | `/tmp/calmly-mail` | Directory for console-mode email files |
| `RESEND_API_KEY` | — | Required when `EMAIL_SENDER=resend` |
| `EMAIL_FROM` | `noreply@example.com` | Sender address shown in magic-link emails |

### Setting up Resend

1. Create an account at [resend.com](https://resend.com)
2. Verify your sending domain (DNS TXT + MX records)
3. Create an API key (Settings → API Keys → Add API Key)
4. Set `EMAIL_SENDER=resend`, `RESEND_API_KEY=<key>`, `EMAIL_FROM=noreply@yourdomain.com`

## Calendar OAuth

The sync server proxies OAuth tokens for Google Calendar and Microsoft Outlook. Both are **optional** — users can still use Calmly without calendar integration.

### Google Calendar

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |

**Setup steps:**

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Application type: Web application)
3. Under Authorized redirect URIs, add: `{BASE_URL}/auth/google/callback`
4. Enable the **Google Calendar API** in APIs & Services → Library
5. Required scopes: `https://www.googleapis.com/auth/calendar.readonly`

### Microsoft Calendar (Outlook)

| Variable | Description |
|---|---|
| `MS_CLIENT_ID` | Azure app (client) ID |
| `MS_CLIENT_SECRET` | Azure client secret value |

**Setup steps:**

1. Go to [Microsoft Entra ID](https://entra.microsoft.com) → App registrations → New registration
2. Set Redirect URI (Web): `{BASE_URL}/auth/microsoft/callback`
3. Under API permissions → Add permission → Microsoft Graph → Delegated → `Calendars.Read`
4. Create a client secret (Certificates & secrets → New client secret); copy the **Value** (not the ID)

## Telegram

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string used to validate incoming webhook payloads |

Telegram is **optional**. Skip this section if you don't need bot integration.

**Setup steps:**

1. Open Telegram, message [@BotFather](https://t.me/BotFather), run `/newbot`
2. Copy the token and set `TELEGRAM_BOT_TOKEN=<token>`
3. Generate a webhook secret: `openssl rand -hex 32` → set `TELEGRAM_WEBHOOK_SECRET=<value>`
4. Register the webhook (after your server is live with HTTPS):

```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${BASE_URL}/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

## TLS / Reverse proxy

OAuth callbacks and Telegram webhooks require HTTPS. Run the sync server behind a TLS-terminating proxy.

**nginx example** (minimal):

```nginx
server {
  listen 443 ssl;
  server_name sync.example.com;

  ssl_certificate     /etc/letsencrypt/live/sync.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/sync.example.com/privkey.pem;

  location / {
    proxy_pass http://localhost:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Caddy** (auto-TLS via Let's Encrypt):

```caddyfile
sync.example.com {
  reverse_proxy localhost:3001
}
```

## Desktop client configuration

In the Calmly desktop app:

1. Open Preferences (Cmd/Ctrl + ,)
2. Navigate to **Sync → Server URL**
3. Enter your `BASE_URL`, e.g. `https://sync.example.com`
4. Restart the app and sign in via magic link

## Troubleshooting

**Server won't start — `DATABASE_URL` error**
Check `docker compose logs sync`. Confirm `DATABASE_URL` is set and Postgres is healthy: `docker compose ps`.

**Magic-link emails not arriving**
- `EMAIL_SENDER=console`: Check `docker exec calmly-sync ls /tmp/calmly-mail/`
- `EMAIL_SENDER=resend`: Verify `RESEND_API_KEY` is set and the sender domain is verified in Resend

**OAuth callback URL mismatch**
The redirect URI registered in Google / Microsoft must exactly match `{BASE_URL}/auth/google/callback` (or `/auth/microsoft/callback`). Trailing slashes and HTTP vs HTTPS matter.

**Telegram webhook returns 401**
Confirm `TELEGRAM_WEBHOOK_SECRET` matches the `secret_token` sent to Telegram's `setWebhook`. Re-register the webhook after changing the secret.
