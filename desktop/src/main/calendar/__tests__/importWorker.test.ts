// CAL-04: Unit tests for the calendar import worker.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { CalendarRefresh } from "../refresh";

const hoisted = vi.hoisted(() => ({
  accounts: [] as Array<{
    id: string;
    provider: "google" | "microsoft";
    status: string;
  }>,
  user: null as { id: string } | null,
  upsertCalls: [] as Array<{ provider: string; externalId: string }>,
  softDeleteCalls: [] as Array<{ provider: string; externalId: string }>,
  fetchGoogleResult: null as
    | null
    | (() => Promise<{ events: unknown[]; nextSyncToken?: string }>),
  fetchMicrosoftResult: null as
    | null
    | (() => Promise<{ events: unknown[]; deltaLink?: string }>),
}));

vi.mock("../../db", () => ({ getDb: vi.fn(() => ({})) }));
vi.mock("../../auth/currentUser", () => ({
  getCurrentUser: () => hoisted.user,
}));
vi.mock("../localStore", () => ({
  listLocalCalendarAccounts: () => hoisted.accounts,
}));
vi.mock("../eventStore", () => ({
  upsertCalendarEvent: (
    _db: unknown,
    args: { provider: string; externalId: string },
  ) => {
    hoisted.upsertCalls.push({
      provider: args.provider,
      externalId: args.externalId,
    });
    return "fake-id";
  },
  softDeleteCalendarEvent: (
    _db: unknown,
    _u: string,
    provider: string,
    externalId: string,
  ) => {
    hoisted.softDeleteCalls.push({ provider, externalId });
    return true;
  },
}));
vi.mock("../providers/google", () => ({
  fetchGoogleEvents: async (..._args: unknown[]) =>
    hoisted.fetchGoogleResult!(),
  googleEventStartMs: () => 1_000,
  googleEventEndMs: () => 2_000,
  GoogleSyncExpiredError: class GoogleSyncExpiredError extends Error {
    constructor() {
      super("expired");
    }
  },
}));
vi.mock("../providers/microsoft", () => ({
  fetchMicrosoftEvents: async (..._args: unknown[]) =>
    hoisted.fetchMicrosoftResult!(),
  microsoftEventStartMs: () => 1_000,
  microsoftEventEndMs: () => 2_000,
  MicrosoftSyncExpiredError: class MicrosoftSyncExpiredError extends Error {
    constructor() {
      super("expired");
    }
  },
}));

import {
  startCalendarImportWorker,
  stopCalendarImportWorker,
  triggerImport,
} from "../importWorker";

const makeRefresh = (ok = true): CalendarRefresh => ({
  getAccessToken: vi.fn(async () =>
    ok
      ? {
          ok: true as const,
          accessToken: "tok",
          expiresAtMs: Date.now() + 3_600_000,
        }
      : { ok: false as const, error: "transient_failure" as const },
  ),
  invalidate: vi.fn(),
});

describe("calendar import worker", () => {
  beforeEach(() => {
    hoisted.user = { id: "u1" };
    hoisted.accounts = [];
    hoisted.upsertCalls = [];
    hoisted.softDeleteCalls = [];
    hoisted.fetchGoogleResult = null;
    hoisted.fetchMicrosoftResult = null;
    stopCalendarImportWorker();
    // Freeze timers so startCalendarImportWorker's immediate importAll()
    // doesn't race with the test's triggerImport() call.
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopCalendarImportWorker();
    vi.useRealTimers();
  });

  it("does nothing when no accounts are connected", async () => {
    hoisted.accounts = [];
    startCalendarImportWorker({ calendarRefresh: makeRefresh() });
    await triggerImport();
    expect(hoisted.upsertCalls).toHaveLength(0);
  });

  it("skips reauth_required accounts", async () => {
    hoisted.accounts = [
      { id: "a1", provider: "google", status: "reauth_required" },
    ];
    startCalendarImportWorker({ calendarRefresh: makeRefresh() });
    await triggerImport("a1");
    expect(hoisted.upsertCalls).toHaveLength(0);
  });

  it("upserts google events", async () => {
    hoisted.accounts = [{ id: "a1", provider: "google", status: "connected" }];
    hoisted.fetchGoogleResult = async () => ({
      events: [
        {
          id: "g1",
          status: "confirmed",
          start: { dateTime: "2024-01-01T10:00:00Z" },
          end: { dateTime: "2024-01-01T11:00:00Z" },
        },
      ],
      nextSyncToken: "tok-g",
    });
    startCalendarImportWorker({ calendarRefresh: makeRefresh() });
    await triggerImport("a1");
    expect(hoisted.upsertCalls).toEqual([
      { provider: "google", externalId: "g1" },
    ]);
  });

  it("soft-deletes cancelled google events", async () => {
    hoisted.accounts = [{ id: "a1", provider: "google", status: "connected" }];
    hoisted.fetchGoogleResult = async () => ({
      events: [{ id: "g2", status: "cancelled", start: {}, end: {} }],
    });
    startCalendarImportWorker({ calendarRefresh: makeRefresh() });
    await triggerImport("a1");
    expect(hoisted.softDeleteCalls).toEqual([
      { provider: "google", externalId: "g2" },
    ]);
    expect(hoisted.upsertCalls).toHaveLength(0);
  });

  it("soft-deletes cancelled microsoft events", async () => {
    hoisted.accounts = [
      { id: "a2", provider: "microsoft", status: "connected" },
    ];
    hoisted.fetchMicrosoftResult = async () => ({
      events: [
        {
          id: "m1",
          isCancelled: true,
          start: { dateTime: "", timeZone: "" },
          end: { dateTime: "", timeZone: "" },
        },
      ],
    });
    startCalendarImportWorker({ calendarRefresh: makeRefresh() });
    await triggerImport("a2");
    expect(hoisted.softDeleteCalls).toEqual([
      { provider: "microsoft", externalId: "m1" },
    ]);
  });

  it("skips import when token fetch fails", async () => {
    hoisted.accounts = [{ id: "a1", provider: "google", status: "connected" }];
    hoisted.fetchGoogleResult = async () => ({ events: [] });
    startCalendarImportWorker({ calendarRefresh: makeRefresh(false) });
    await triggerImport("a1");
    expect(hoisted.upsertCalls).toHaveLength(0);
  });
});
