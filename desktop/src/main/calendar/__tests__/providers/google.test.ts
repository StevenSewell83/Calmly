// calmly-1f0: Unit tests for the Google Calendar provider.
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  fetchGoogleEvents,
  googleEventStartMs,
  googleEventEndMs,
  GoogleSyncExpiredError,
  type GoogleEvent,
} from "../../providers/google";

const makeFetch = (pages: object[]): typeof fetch => {
  let call = 0;
  return vi.fn(async () => {
    const body = pages[call++] ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => "",
    } as unknown as Response;
  });
};

const makeErrorFetch = (status: number): typeof fetch =>
  vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => "",
  })) as unknown as typeof fetch;

const ev = (id: string, status = "confirmed"): GoogleEvent => ({
  id,
  status,
  start: { dateTime: "2024-03-01T10:00:00Z" },
  end: { dateTime: "2024-03-01T11:00:00Z" },
});

const allDayEv = (id: string): GoogleEvent => ({
  id,
  status: "confirmed",
  start: { date: "2024-03-01" },
  end: { date: "2024-03-02" },
});

describe("fetchGoogleEvents", () => {
  const W_START = 0;
  const W_END = 1_000_000;

  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });

  it("returns events from a single page with nextSyncToken", async () => {
    const page = { items: [ev("g1"), ev("g2")], nextSyncToken: "tok-1" };
    vi.stubGlobal("fetch", makeFetch([page]));

    const result = await fetchGoogleEvents("access", W_START, W_END);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.id).toBe("g1");
    expect(result.nextSyncToken).toBe("tok-1");
  });

  it("sends syncToken when provided (incremental sync)", async () => {
    const mockFetch = makeFetch([
      { items: [ev("g3")], nextSyncToken: "tok-2" },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await fetchGoogleEvents("access", W_START, W_END, "tok-prev");

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(url).toContain("syncToken=tok-prev");
    expect(url).not.toContain("timeMin");
  });

  it("sends timeMin/timeMax when no syncToken (full sync)", async () => {
    const mockFetch = makeFetch([{ items: [], nextSyncToken: "tok-3" }]);
    vi.stubGlobal("fetch", mockFetch);

    await fetchGoogleEvents("access", W_START, W_END);

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(url).toContain("timeMin=");
    expect(url).toContain("timeMax=");
    expect(url).not.toContain("syncToken=");
  });

  it("paginates across multiple pages", async () => {
    const page1 = { items: [ev("p1")], nextPageToken: "pg2" };
    const page2 = { items: [ev("p2"), ev("p3")], nextSyncToken: "tok-final" };
    vi.stubGlobal("fetch", makeFetch([page1, page2]));

    const result = await fetchGoogleEvents("access", W_START, W_END);
    expect(result.events).toHaveLength(3);
    expect(result.nextSyncToken).toBe("tok-final");
  });

  it("second page request includes pageToken", async () => {
    const mockFetch = makeFetch([
      { items: [ev("x1")], nextPageToken: "next-page" },
      { items: [ev("x2")], nextSyncToken: "tok-x" },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await fetchGoogleEvents("access", W_START, W_END);

    const url2 = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[1]![0] as string;
    expect(url2).toContain("pageToken=next-page");
  });

  it("throws GoogleSyncExpiredError on 410", async () => {
    vi.stubGlobal("fetch", makeErrorFetch(410));
    await expect(
      fetchGoogleEvents("access", W_START, W_END, "stale-tok"),
    ).rejects.toBeInstanceOf(GoogleSyncExpiredError);
  });

  it("throws generic error on non-410 HTTP error", async () => {
    vi.stubGlobal("fetch", makeErrorFetch(503));
    await expect(fetchGoogleEvents("access", W_START, W_END)).rejects.toThrow(
      "503",
    );
  });

  it("includes cancelled events in output (worker decides what to do)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetch([{ items: [ev("g-del", "cancelled")], nextSyncToken: "t" }]),
    );
    const result = await fetchGoogleEvents("access", W_START, W_END);
    expect(result.events[0]!.status).toBe("cancelled");
  });

  it("handles missing items array gracefully", async () => {
    vi.stubGlobal("fetch", makeFetch([{ nextSyncToken: "t" }]));
    const result = await fetchGoogleEvents("access", W_START, W_END);
    expect(result.events).toHaveLength(0);
  });
});

describe("googleEventStartMs / googleEventEndMs", () => {
  it("parses dateTime events", () => {
    const e = ev("x");
    expect(googleEventStartMs(e)).toBe(
      new Date("2024-03-01T10:00:00Z").getTime(),
    );
    expect(googleEventEndMs(e)).toBe(
      new Date("2024-03-01T11:00:00Z").getTime(),
    );
  });

  it("parses all-day events using date field", () => {
    const e = allDayEv("y");
    expect(googleEventStartMs(e)).toBe(new Date("2024-03-01").getTime());
    expect(googleEventEndMs(e)).toBe(new Date("2024-03-02").getTime());
  });

  it("returns 0 for empty start/end", () => {
    const e: GoogleEvent = { id: "z", start: {}, end: {} };
    expect(googleEventStartMs(e)).toBe(0);
    expect(googleEventEndMs(e)).toBe(0);
  });
});
