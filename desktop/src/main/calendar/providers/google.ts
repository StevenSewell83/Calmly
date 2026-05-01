// CAL-04: Google Calendar event fetcher.
//
// Uses the Google Calendar REST API v3 with server-expanded instances
// (singleEvents=true) so we never parse RRULE locally. All-day events use
// date-only fields; timed events use dateTime + timeZone.
//
// Incremental sync uses pageToken for pagination and nextSyncToken for
// delta fetches. If the server returns a 410 Gone the sync token has expired
// and we fall back to a full window fetch.

export interface GoogleEvent {
  id: string;
  summary?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  status?: string; // "confirmed" | "tentative" | "cancelled"
  etag?: string;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string };
}

interface GoogleEventsPage {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface GoogleFetchResult {
  events: GoogleEvent[];
  nextSyncToken?: string;
}

export class GoogleSyncExpiredError extends Error {
  constructor() {
    super("google sync token expired");
    this.name = "GoogleSyncExpiredError";
  }
}

const GOOGLE_API = "https://www.googleapis.com/calendar/v3";

export async function fetchGoogleEvents(
  accessToken: string,
  windowStartMs: number,
  windowEndMs: number,
  syncToken?: string,
): Promise<GoogleFetchResult> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const url = buildUrl(windowStartMs, windowEndMs, syncToken, pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 410) throw new GoogleSyncExpiredError();

    if (!res.ok) {
      throw new Error(`Google Calendar API error: ${res.status}`);
    }

    const page = (await res.json()) as GoogleEventsPage;
    for (const ev of page.items ?? []) {
      events.push(ev);
    }
    pageToken = page.nextPageToken;
    nextSyncToken = page.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

function buildUrl(
  windowStartMs: number,
  windowEndMs: number,
  syncToken?: string,
  pageToken?: string,
): string {
  const params = new URLSearchParams({
    singleEvents: "true",
    maxResults: "250",
  });

  if (syncToken) {
    params.set("syncToken", syncToken);
  } else {
    params.set("timeMin", new Date(windowStartMs).toISOString());
    params.set("timeMax", new Date(windowEndMs).toISOString());
    params.set("orderBy", "startTime");
  }

  if (pageToken) params.set("pageToken", pageToken);

  return `${GOOGLE_API}/calendars/primary/events?${params.toString()}`;
}

// Normalize a Google Event start/end to UTC epoch ms.
export function googleEventStartMs(ev: GoogleEvent): number {
  return parseGoogleDateTime(ev.start);
}

export function googleEventEndMs(ev: GoogleEvent): number {
  return parseGoogleDateTime(ev.end);
}

function parseGoogleDateTime(dt: {
  dateTime?: string;
  date?: string;
}): number {
  if (dt.dateTime) return new Date(dt.dateTime).getTime();
  if (dt.date) return new Date(dt.date).getTime();
  return 0;
}
