# Database Migrations

Calmly uses [node-pg-migrate](https://github.com/salsita/node-pg-migrate) for schema management. Migrations live in `server/migrations/` and run automatically on server startup.

## How the runner works

- Applied migrations are recorded in the `pgmigrations` tracking table.
- node-pg-migrate **never re-applies a recorded migration**, so migrations are inherently idempotent at the runner level.
- Each migration runs inside a single Postgres transaction; a failure rolls back the entire migration and leaves the database unchanged.
- The server's startup command runs `migrate up` before binding the HTTP port, so the database is always schema-current before accepting requests.

## Applied migrations

### 0001_init — Placeholder

Marks the migration runner as wired without touching the schema. **Must not be removed** — deleting it would shift subsequent migration numbers and corrupt existing installations.

- **Rollback**: No-op; nothing to reverse.

### 0002_auth — Magic-link auth schema

Creates `users`, `magic_link_tokens`, `sessions`. Hashed tokens only (raw token never persisted). `pgcrypto` extension required.

- **Rollback**: `exports.down` drops all three tables in reverse FK order. Safe on a fresh database; destructive on a live one (all users and sessions lost). Never run on production.

### 0003_sync — Sync protocol v1

Creates the full domain schema: `inbox_items`, `tasks`, `events`, `reminder_rules`, `recurrence_rules`, `calendar_event_imports`, `ai_suggestions`, `telegram_links`, `user_settings`, plus the `sync_version` sequence.

- **Rollback**: `exports.down` drops all tables and the sequence. All user data is lost. Never run on production.

### 0004_inbox_snooze — Inbox snooze column

Adds `inbox_items.snoozed_until BIGINT NULL` and a partial index.

- **Rollback**: `exports.down` drops the index and column. Snooze data is lost; other inbox items are unaffected.

### 0005_task_schedule — Task time-block columns

Adds `tasks.scheduled_start` and `tasks.scheduled_end` (both `BIGINT NULL`) and a partial index.

- **Rollback**: `exports.down` drops the index and columns. Scheduling data is lost; task titles/statuses are unaffected.

### 0006_user_settings_id — Synthetic `id` PK for user_settings

Adds a UUID `id` column, backfills existing rows, swaps the primary key from `user_id` to `id`, adds `UNIQUE(user_id)`.

- **Rollback**: `exports.down` restores the original `user_id` primary key and drops the `id` column. Safe only if the new `id` values are not yet referenced by clients.

## Authoring a new migration

Copy `server/migrations/_template.cjs` and follow these rules:

1. **Forward-only style**: prefer additive changes (new tables, new nullable columns). Avoid destructive DDL (`DROP COLUMN`, `ALTER TYPE`) unless the column/table is confirmed empty.
2. **No raw `CREATE TABLE`** without `IF NOT EXISTS` when the migration may be applied against a partially-provisioned database. (node-pg-migrate's transaction wrapper usually makes this moot, but be explicit.)
3. **Provide `exports.down`** for every migration, even if it only drops what `up` added. Document if reverting is destructive.
4. **Backfill inside the migration** when adding a `NOT NULL` column to a table with existing rows (see 0006 for the pattern: add nullable → backfill → alter NOT NULL).
5. **Test locally** against a fresh database before opening a PR: `docker compose up -d postgres && pnpm --filter @calmly/server migrate`.

## Backup and restore (self-hosters)

### Backup

```bash
# Full logical backup
docker exec calmly-postgres pg_dump \
  -U calmly \
  -d calmly \
  -Fc \
  -f /tmp/calmly-backup-$(date +%Y%m%d-%H%M%S).dump

# Copy the file out of the container
docker cp calmly-postgres:/tmp/calmly-backup-*.dump ./backups/
```

Recommended cadence: **daily** for production. Store backups off-host (S3, Backblaze, etc.).

### Restore

```bash
# 1. Stop the server so no writes arrive during restore
docker compose stop sync

# 2. Drop and recreate the database
docker exec calmly-postgres psql -U calmly -c "DROP DATABASE calmly;"
docker exec calmly-postgres psql -U calmly -c "CREATE DATABASE calmly;"

# 3. Restore from dump
docker exec -i calmly-postgres pg_restore \
  -U calmly \
  -d calmly \
  --no-owner \
  < ./backups/calmly-backup-YYYYMMDD-HHMMSS.dump

# 4. Restart (migrations re-verify but will not re-apply)
docker compose start sync
```

### Restore drill

Perform a restore drill before going to production:

1. Take a backup of a test database.
2. Restore it to an empty Postgres instance.
3. Start the sync server against the restored database and confirm `/health` returns 200.
4. Sign in via magic link and verify data looks correct.
