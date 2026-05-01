import type { CalendarAccountStatus } from "@calmly/shared";

// Lightweight in-process pubsub for calendar account status changes. The
// IPC layer subscribes once and rebroadcasts to every BrowserWindow as
// `calendar:account-status-changed`. The refresh worker (and any future
// background job that mutates account status) emits via `notify`.

export interface AccountStatusEvent {
  accountId: string;
  status: CalendarAccountStatus;
}

type Handler = (e: AccountStatusEvent) => void;

const handlers = new Set<Handler>();

export const calendarStatusEvents = {
  notify(event: AccountStatusEvent): void {
    for (const h of handlers) {
      try {
        h(event);
      } catch {
        // Subscribers must not break the emitter.
      }
    }
  },

  subscribe(handler: Handler): () => void {
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  },

  // Test helper — drop every subscriber so individual specs start clean.
  __resetForTests(): void {
    handlers.clear();
  },
} as const;
