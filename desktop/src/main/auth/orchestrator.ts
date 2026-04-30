import type Database from "better-sqlite3";
import type { AuthOrchestrator } from "./session";
import { setCurrentUser } from "./currentUser";

// Wraps the base orchestrator so every auth state change keeps the local
// currentUser cache + users-table mirror in sync. The IPC handler reads
// through this wrapper; the deep-link redeem path talks to the wrapper too
// so the cache is always populated before any inbox/task write IPC fires.
export function wrapOrchestrator(
  base: AuthOrchestrator,
  getDb: () => Database.Database,
): AuthOrchestrator {
  return {
    requestLink: (email) => base.requestLink(email),
    redeem: async (token) => {
      const r = await base.redeem(token);
      if (r.ok) setCurrentUser(getDb(), r.user);
      return r;
    },
    status: async () => {
      const r = await base.status();
      setCurrentUser(getDb(), r.signedIn ? r.user : null);
      return r;
    },
    signOut: async () => {
      const r = await base.signOut();
      setCurrentUser(getDb(), null);
      return r;
    },
  };
}
