import type { CalendarProvider } from "@calmly/shared";
import { secretStore, type SecretKey } from "../security/secretStore";

// Typed wrappers around the F-12 secret store for calendar refresh tokens.
// The key shape (`calendar.<provider>.refresh_token:<account_id>`) is a hard
// contract enforced server-side AND in secretStore.PARAM_KEY_RE — keep all
// access flowing through here so a future rename only touches one file.

export function refreshTokenKey(
  provider: CalendarProvider,
  accountId: string,
): SecretKey {
  return `calendar.${provider}.refresh_token:${accountId}` as SecretKey;
}

export const calendarTokens = {
  set(provider: CalendarProvider, accountId: string, refreshToken: string): void {
    secretStore.set(refreshTokenKey(provider, accountId), refreshToken);
  },

  get(provider: CalendarProvider, accountId: string): string | null {
    return secretStore.get(refreshTokenKey(provider, accountId));
  },

  has(provider: CalendarProvider, accountId: string): boolean {
    return secretStore.has(refreshTokenKey(provider, accountId));
  },

  delete(provider: CalendarProvider, accountId: string): void {
    secretStore.delete(refreshTokenKey(provider, accountId));
  },
} as const;
