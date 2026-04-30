-- BUG-AUDIT-4 (calmly-3py.4): drop the magic-link columns from the
-- desktop users table.
--
-- These columns existed in shared/UserSchema and the desktop schema
-- but never appeared on the server (server keeps magic-link state in
-- its own magic_link_tokens table). The drift was a latent sync time
-- bomb: any server users-row pull would fail UserSchema.parse, and
-- the columns weren't load-bearing on either side. No live caller
-- reads or writes them on the desktop.
--
-- SQLite supports DROP COLUMN on STRICT tables since 3.35 (April
-- 2021). better-sqlite3 ships 3.49+. The columns aren't part of any
-- index or constraint, so the drop is a one-liner per column.

ALTER TABLE users DROP COLUMN magic_link_token_hash;
ALTER TABLE users DROP COLUMN magic_link_expires_at;
