import type { AuthOrchestrator, AuthUser } from "./session";

// Dev-only orchestrator that short-circuits auth so feature work doesn't
// require Docker + sync server + magic-link round trip. Gated by
// CALMLY_DEV_AUTH=stub at the call site, which also checks !app.isPackaged.
// See calmly-f6o.

export const DEV_STUB_USER: AuthUser = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "dev@calmly.local",
};

export function createDevStubOrchestrator(): AuthOrchestrator {
  const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return {
    async requestLink() {
      return { ok: true };
    },
    async redeem() {
      return { ok: true, user: DEV_STUB_USER, expiresAt };
    },
    async status() {
      return { signedIn: true, user: DEV_STUB_USER };
    },
    async signOut() {
      return { ok: true };
    },
  };
}
