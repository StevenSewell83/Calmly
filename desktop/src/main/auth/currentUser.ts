import type Database from "better-sqlite3";
import type { AuthUser } from "./session";

// In-memory cache of the signed-in user. The auth orchestrator's
// public API is HTTP-only; for local-DB writes (inbox.add, tasks.create,
// …) we need synchronous access to the user_id without round-tripping
// /auth/me on every keystroke. main/index.ts is responsible for keeping
// this cache in sync with the orchestrator's results.
let current: AuthUser | null = null;

export function getCurrentUser(): AuthUser | null {
  return current;
}

// Set or clear the cached user. When setting, mirrors the user into the
// local SQLite users table so foreign keys on user-owned rows
// (inbox_items, tasks, events, …) resolve. The mirror is idempotent.
export function setCurrentUser(
  db: Database.Database,
  user: AuthUser | null,
): void {
  current = user;
  if (!user) return;
  // INSERT OR REPLACE keeps the row in sync if the email ever changes
  // server-side (rare but possible). created_at is preserved on first
  // insert because of the column default; we only overwrite id+email.
  db.prepare(
    `INSERT INTO users (id, email)
     VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email`,
  ).run(user.id, user.email);
}

// Test helper — resets the module-level singleton so each spec starts
// from a known state.
export function __resetCurrentUserForTests(): void {
  current = null;
}
