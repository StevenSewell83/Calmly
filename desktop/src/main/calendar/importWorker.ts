// CAL-04: Periodic + on-demand calendar event import worker.
//
// Fetches events from each connected provider on a 15-minute schedule and
// writes CalendarEventImport rows to the local cache. Concurrency: only one
// import per account runs at a time; overlapping calls are dropped (not queued).
//
// Sync tokens (Google nextSyncToken, Microsoft deltaLink) are held in memory.
// On restart we do a full sliding-window fetch (now-1d … now+30d).

import { getDb } from "../db";
import { getCurrentUser } from "../auth/currentUser";
import { listLocalCalendarAccounts } from "./localStore";
import type { CalendarRefresh } from "./refresh";
import {
  fetchGoogleEvents,
  googleEventStartMs,
  googleEventEndMs,
  GoogleSyncExpiredError,
  type GoogleEvent,
} from "./providers/google";
import {
  fetchMicrosoftEvents,
  microsoftEventStartMs,
  microsoftEventEndMs,
  MicrosoftSyncExpiredError,
  type MicrosoftEvent,
} from "./providers/microsoft";
import {
  upsertCalendarEvent,
  softDeleteCalendarEvent,
} from "./eventStore";

const POLL_INTERVAL_MS = 15 * 60_000;
const WINDOW_PAST_MS = 24 * 60 * 60_000;
const WINDOW_FUTURE_MS = 30 * 24 * 60 * 60_000;

// In-memory sync tokens keyed by accountId.
const googleSyncTokens = new Map<string, string>();
const microsoftDeltaLinks = new Map<string, string>();

// Accounts currently being imported (concurrency guard).
const inFlight = new Set<string>();

export interface ImportWorkerDeps {
  calendarRefresh: CalendarRefresh;
  log?: (msg: string, fields?: Record<string, unknown>) => void;
  now?: () => number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let deps_: ImportWorkerDeps | null = null;

export function startCalendarImportWorker(deps: ImportWorkerDeps): void {
  deps_ = deps;
  if (timer) return;
  timer = setInterval(() => { void importAll(deps); }, POLL_INTERVAL_MS);
  // Defer initial fetch so the app is fully initialized before network I/O.
  setTimeout(() => { void importAll(deps); }, 0);
}

export function stopCalendarImportWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
  deps_ = null;
}

// On-demand: import one account or all accounts.
export async function triggerImport(accountId?: string): Promise<void> {
  const deps = deps_;
  if (!deps) return;
  if (accountId) {
    await importAccount(accountId, deps);
  } else {
    await importAll(deps);
  }
}

async function importAll(deps: ImportWorkerDeps): Promise<void> {
  const accounts = listLocalCalendarAccounts();
  for (const account of accounts) {
    if (account.status === "reauth_required" || account.status === "disconnected") continue;
    await importAccount(account.id, deps);
  }
}

async function importAccount(accountId: string, deps: ImportWorkerDeps): Promise<void> {
  if (inFlight.has(accountId)) return;
  inFlight.add(accountId);
  try {
    await _importAccount(accountId, deps);
  } finally {
    inFlight.delete(accountId);
  }
}

async function _importAccount(accountId: string, deps: ImportWorkerDeps): Promise<void> {
  const log = deps.log ?? (() => {});
  const now = (deps.now ?? Date.now)();
  const user = getCurrentUser();
  if (!user) return;

  const accounts = listLocalCalendarAccounts();
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return;

  const tokenResult = await deps.calendarRefresh.getAccessToken(
    account.provider,
    accountId,
  );
  if (!tokenResult.ok) {
    log("calendar import: token unavailable", { accountId, error: tokenResult.error });
    return;
  }
  const { accessToken } = tokenResult;
  const windowStart = now - WINDOW_PAST_MS;
  const windowEnd = now + WINDOW_FUTURE_MS;
  const db = getDb();

  try {
    if (account.provider === "google") {
      await importGoogle(db, user.id, accountId, accessToken, windowStart, windowEnd, now, log);
    } else {
      await importMicrosoft(db, user.id, accountId, accessToken, windowStart, windowEnd, now, log);
    }
  } catch (err) {
    log("calendar import: fetch error", { accountId, err: String(err) });
  }
}

async function importGoogle(
  db: ReturnType<typeof getDb>,
  userId: string,
  accountId: string,
  accessToken: string,
  windowStart: number,
  windowEnd: number,
  now: number,
  log: NonNullable<ImportWorkerDeps["log"]>,
): Promise<void> {
  const syncToken = googleSyncTokens.get(accountId);
  let result;

  try {
    result = await fetchGoogleEvents(accessToken, windowStart, windowEnd, syncToken);
  } catch (err) {
    if (err instanceof GoogleSyncExpiredError) {
      log("google sync token expired, full refetch", { accountId });
      googleSyncTokens.delete(accountId);
      result = await fetchGoogleEvents(accessToken, windowStart, windowEnd);
    } else {
      throw err;
    }
  }

  for (const ev of result.events) {
    processGoogleEvent(db, userId, ev, now);
  }
  if (result.nextSyncToken) {
    googleSyncTokens.set(accountId, result.nextSyncToken);
  }
  log("google import done", { accountId, count: result.events.length });
}

async function importMicrosoft(
  db: ReturnType<typeof getDb>,
  userId: string,
  accountId: string,
  accessToken: string,
  windowStart: number,
  windowEnd: number,
  now: number,
  log: NonNullable<ImportWorkerDeps["log"]>,
): Promise<void> {
  const deltaLink = microsoftDeltaLinks.get(accountId);
  let result;

  try {
    result = await fetchMicrosoftEvents(accessToken, windowStart, windowEnd, deltaLink);
  } catch (err) {
    if (err instanceof MicrosoftSyncExpiredError) {
      log("microsoft delta expired, full refetch", { accountId });
      microsoftDeltaLinks.delete(accountId);
      result = await fetchMicrosoftEvents(accessToken, windowStart, windowEnd);
    } else {
      throw err;
    }
  }

  for (const ev of result.events) {
    processMicrosoftEvent(db, userId, ev, now);
  }
  if (result.deltaLink) {
    microsoftDeltaLinks.set(accountId, result.deltaLink);
  }
  log("microsoft import done", { accountId, count: result.events.length });
}

function processGoogleEvent(
  db: ReturnType<typeof getDb>,
  userId: string,
  ev: GoogleEvent,
  now: number,
): void {
  if (ev.status === "cancelled") {
    softDeleteCalendarEvent(db, userId, "google", ev.id, now);
    return;
  }
  upsertCalendarEvent(db, {
    userId,
    provider: "google",
    externalId: ev.id,
    rawJson: JSON.stringify(ev),
    startAt: googleEventStartMs(ev),
    endAt: googleEventEndMs(ev),
    now,
  });
}

function processMicrosoftEvent(
  db: ReturnType<typeof getDb>,
  userId: string,
  ev: MicrosoftEvent,
  now: number,
): void {
  if (ev["@removed"] || ev.isCancelled) {
    softDeleteCalendarEvent(db, userId, "microsoft", ev.id, now);
    return;
  }
  upsertCalendarEvent(db, {
    userId,
    provider: "microsoft",
    externalId: ev.id,
    rawJson: JSON.stringify(ev),
    startAt: microsoftEventStartMs(ev),
    endAt: microsoftEventEndMs(ev),
    now,
  });
}
