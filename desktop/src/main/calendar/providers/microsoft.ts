// CAL-04: Microsoft Graph Calendar event fetcher.
//
// Uses the calendarView endpoint (server-expanded instances) to avoid
// local RRULE expansion. Incremental sync uses @odata.deltaLink.
// A 410 Gone or "SyncStateNotFound" OData error means the delta is stale;
// fall back to a full window fetch.

export interface MicrosoftEvent {
  id: string;
  subject?: string;
  location?: { displayName?: string };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  seriesMasterId?: string;
  "@removed"?: { reason: string };
}

interface MicrosoftEventsPage {
  value: MicrosoftEvent[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
}

export interface MicrosoftFetchResult {
  events: MicrosoftEvent[];
  deltaLink?: string;
}

export class MicrosoftSyncExpiredError extends Error {
  constructor() {
    super("microsoft delta link expired");
    this.name = "MicrosoftSyncExpiredError";
  }
}

const GRAPH_API = "https://graph.microsoft.com/v1.0";

export async function fetchMicrosoftEvents(
  accessToken: string,
  windowStartMs: number,
  windowEndMs: number,
  deltaLink?: string,
): Promise<MicrosoftFetchResult> {
  const events: MicrosoftEvent[] = [];
  let nextUrl = deltaLink ?? buildCalendarViewUrl(windowStartMs, windowEndMs);
  let deltaLinkOut: string | undefined;

  do {
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });

    if (res.status === 410) throw new MicrosoftSyncExpiredError();
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (text.includes("SyncStateNotFound")) throw new MicrosoftSyncExpiredError();
      throw new Error(`Microsoft Graph API error: ${res.status}`);
    }

    const page = (await res.json()) as MicrosoftEventsPage;
    for (const ev of page.value ?? []) {
      events.push(ev);
    }
    nextUrl = page["@odata.nextLink"] ?? "";
    deltaLinkOut = page["@odata.deltaLink"];
  } while (nextUrl);

  return { events, deltaLink: deltaLinkOut };
}

function buildCalendarViewUrl(startMs: number, endMs: number): string {
  const params = new URLSearchParams({
    startDateTime: new Date(startMs).toISOString(),
    endDateTime: new Date(endMs).toISOString(),
    $top: "250",
    $select: "id,subject,location,start,end,isAllDay,isCancelled,seriesMasterId",
  });
  return `${GRAPH_API}/me/calendarView/delta?${params.toString()}`;
}

// Normalize Microsoft start/end to UTC epoch ms (Graph returns UTC when
// Prefer: outlook.timezone="UTC" is set, so direct parse is correct).
export function microsoftEventStartMs(ev: MicrosoftEvent): number {
  return new Date(ev.start.dateTime).getTime();
}

export function microsoftEventEndMs(ev: MicrosoftEvent): number {
  return new Date(ev.end.dateTime).getTime();
}
