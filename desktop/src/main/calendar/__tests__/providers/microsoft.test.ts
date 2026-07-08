// calmly-e68: Unit tests for the Microsoft Graph Calendar provider.
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  fetchMicrosoftEvents,
  microsoftEventStartMs,
  microsoftEventEndMs,
  MicrosoftSyncExpiredError,
  type MicrosoftEvent,
} from "../../providers/microsoft";

const makeEv = (
  id: string,
  extra: Partial<MicrosoftEvent> = {},
): MicrosoftEvent => ({
  id,
  start: { dateTime: "2024-03-01T10:00:00", timeZone: "UTC" },
  end: { dateTime: "2024-03-01T11:00:00", timeZone: "UTC" },
  ...extra,
});

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

const makeErrorFetch = (status: number, text = ""): typeof fetch =>
  vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  })) as unknown as typeof fetch;

describe("fetchMicrosoftEvents", () => {
  const W_START = 0;
  const W_END = 1_000_000;

  beforeEach(() => {
    vi.stubGlobal("fetch", undefined);
  });

  it("returns events from a single page with deltaLink", async () => {
    const page = {
      value: [makeEv("m1"), makeEv("m2")],
      "@odata.deltaLink": "delta-1",
    };
    vi.stubGlobal("fetch", makeFetch([page]));

    const result = await fetchMicrosoftEvents("access", W_START, W_END);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]!.id).toBe("m1");
    expect(result.deltaLink).toBe("delta-1");
  });

  it("uses deltaLink URL directly on incremental sync", async () => {
    const mockFetch = makeFetch([
      { value: [makeEv("m3")], "@odata.deltaLink": "delta-2" },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await fetchMicrosoftEvents(
      "access",
      W_START,
      W_END,
      "https://graph.microsoft.com/delta?$token=abc",
    );

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(url).toBe("https://graph.microsoft.com/delta?$token=abc");
  });

  it("builds calendarView URL for full sync (no deltaLink)", async () => {
    const mockFetch = makeFetch([{ value: [], "@odata.deltaLink": "d" }]);
    vi.stubGlobal("fetch", mockFetch);

    await fetchMicrosoftEvents("access", W_START, W_END);

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(url).toContain("calendarView/delta");
    expect(url).toContain("startDateTime=");
  });

  it("paginates using @odata.nextLink", async () => {
    const page1 = {
      value: [makeEv("p1")],
      "@odata.nextLink": "https://graph.microsoft.com/next",
    };
    const page2 = { value: [makeEv("p2")], "@odata.deltaLink": "delta-final" };
    vi.stubGlobal("fetch", makeFetch([page1, page2]));

    const result = await fetchMicrosoftEvents("access", W_START, W_END);
    expect(result.events).toHaveLength(2);
    expect(result.deltaLink).toBe("delta-final");
  });

  it("second page request uses nextLink URL", async () => {
    const mockFetch = makeFetch([
      {
        value: [makeEv("x1")],
        "@odata.nextLink": "https://graph.microsoft.com/page2",
      },
      { value: [makeEv("x2")], "@odata.deltaLink": "d" },
    ]);
    vi.stubGlobal("fetch", mockFetch);

    await fetchMicrosoftEvents("access", W_START, W_END);

    const url2 = (mockFetch as ReturnType<typeof vi.fn>).mock
      .calls[1]![0] as string;
    expect(url2).toBe("https://graph.microsoft.com/page2");
  });

  it("throws MicrosoftSyncExpiredError on 410", async () => {
    vi.stubGlobal("fetch", makeErrorFetch(410));
    await expect(
      fetchMicrosoftEvents("access", W_START, W_END, "stale"),
    ).rejects.toBeInstanceOf(MicrosoftSyncExpiredError);
  });

  it("throws MicrosoftSyncExpiredError when body contains SyncStateNotFound", async () => {
    vi.stubGlobal(
      "fetch",
      makeErrorFetch(400, '{"error":{"code":"SyncStateNotFound"}}'),
    );
    await expect(
      fetchMicrosoftEvents("access", W_START, W_END, "stale"),
    ).rejects.toBeInstanceOf(MicrosoftSyncExpiredError);
  });

  it("throws generic error on other HTTP errors", async () => {
    vi.stubGlobal("fetch", makeErrorFetch(503, "Service unavailable"));
    await expect(
      fetchMicrosoftEvents("access", W_START, W_END),
    ).rejects.toThrow("503");
  });

  it("includes @removed events in output (worker handles deletion)", async () => {
    const removed: MicrosoftEvent = {
      ...makeEv("m-del"),
      "@removed": { reason: "deleted" },
    };
    vi.stubGlobal(
      "fetch",
      makeFetch([{ value: [removed], "@odata.deltaLink": "d" }]),
    );

    const result = await fetchMicrosoftEvents("access", W_START, W_END);
    expect(result.events[0]!["@removed"]).toBeDefined();
  });

  it("handles missing value array gracefully", async () => {
    vi.stubGlobal("fetch", makeFetch([{ "@odata.deltaLink": "d" }]));
    const result = await fetchMicrosoftEvents("access", W_START, W_END);
    expect(result.events).toHaveLength(0);
  });
});

describe("microsoftEventStartMs / microsoftEventEndMs", () => {
  it("parses UTC dateTime strings", () => {
    const e = makeEv("x");
    expect(microsoftEventStartMs(e)).toBe(
      new Date("2024-03-01T10:00:00").getTime(),
    );
    expect(microsoftEventEndMs(e)).toBe(
      new Date("2024-03-01T11:00:00").getTime(),
    );
  });

  it("parses all-day event dateTime (midnight UTC)", () => {
    const e: MicrosoftEvent = {
      id: "y",
      isAllDay: true,
      start: { dateTime: "2024-03-01T00:00:00", timeZone: "UTC" },
      end: { dateTime: "2024-03-02T00:00:00", timeZone: "UTC" },
    };
    expect(microsoftEventStartMs(e)).toBe(
      new Date("2024-03-01T00:00:00").getTime(),
    );
    expect(microsoftEventEndMs(e)).toBe(
      new Date("2024-03-02T00:00:00").getTime(),
    );
  });
});
