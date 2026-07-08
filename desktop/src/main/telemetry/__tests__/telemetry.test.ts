// POL-01: Unit tests for telemetry outbox worker + event schema.
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  outbox: [] as Array<Record<string, unknown>>,
  storedId: null as string | null,
  flushCalls: [] as unknown[][],
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(() => ({
    prepare: (sql: string) => ({
      run: (...args: unknown[]) => {
        if (sql.includes("INSERT INTO telemetry_outbox")) {
          const [id, eventName, anonId, sessId, propsJson, createdAt] = args;
          hoisted.outbox.push({
            id,
            event_name: eventName,
            anonymous_id: anonId,
            session_id: sessId,
            props_json: propsJson,
            created_at: createdAt,
          });
        } else if (sql.includes("DELETE FROM telemetry_outbox")) {
          hoisted.outbox.splice(0);
        }
        return { changes: 1 };
      },
      get: () => {
        if (sql.includes("settings_json")) {
          return { settings_json: JSON.stringify(hoisted.settings) };
        }
        if (sql.includes("COUNT(*)")) {
          return { n: hoisted.outbox.length };
        }
        return undefined;
      },
      all: (_limit: number) => hoisted.outbox.slice(0, _limit),
    }),
  })),
}));

vi.mock("../../security/secretStore", () => ({
  secretStore: {
    get: () => hoisted.storedId,
    set: (key: string, value: string) => {
      hoisted.storedId = value;
    },
    has: () => hoisted.storedId !== null,
    delete: () => {
      hoisted.storedId = null;
    },
  },
}));

import {
  emitTelemetryEvent,
  startTelemetryWorker,
  stopTelemetryWorker,
  purgeOutbox,
  getOrCreateAnonymousId,
} from "../index";
import type { ApiClient } from "../../net/client";
import { TelemetryBatchSchema, TelemetryEventSchema } from "@calmly/shared";

const makeClient = (): ApiClient => ({
  request: vi.fn(async (...args: unknown[]) => {
    hoisted.flushCalls.push(args);
    return { status: 202, body: { accepted: 1 } };
  }) as unknown as ApiClient["request"],
});

describe("telemetry event schema (shared)", () => {
  it("accepts a valid event", () => {
    const result = TelemetryEventSchema.safeParse({
      event: "app.opened",
      anonymous_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      timestamp: Date.now(),
      props: { source: "desktop" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown event name", () => {
    const result = TelemetryEventSchema.safeParse({
      event: "user.password.changed",
      anonymous_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it("rejects deny-listed prop key 'title'", () => {
    const result = TelemetryEventSchema.safeParse({
      event: "capture.created",
      anonymous_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      timestamp: Date.now(),
      props: { title: "Buy milk" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects deny-listed prop key containing 'message'", () => {
    const result = TelemetryEventSchema.safeParse({
      event: "error.shown",
      anonymous_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      timestamp: Date.now(),
      props: { error_message: "something" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects free-text prop values (spaces)", () => {
    const result = TelemetryEventSchema.safeParse({
      event: "app.opened",
      anonymous_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      timestamp: Date.now(),
      props: { source: "desktop app with spaces" },
    });
    expect(result.success).toBe(false);
  });
});

describe("TelemetryBatchSchema", () => {
  it("rejects an empty batch", () => {
    const result = TelemetryBatchSchema.safeParse({ events: [] });
    expect(result.success).toBe(false);
  });

  it("rejects a batch over 100 events", () => {
    const ev = {
      event: "app.opened" as const,
      anonymous_id: "00000000-0000-0000-0000-000000000001",
      session_id: "00000000-0000-0000-0000-000000000002",
      timestamp: Date.now(),
    };
    const result = TelemetryBatchSchema.safeParse({
      events: Array(101).fill(ev),
    });
    expect(result.success).toBe(false);
  });
});

describe("emitTelemetryEvent", () => {
  beforeEach(() => {
    hoisted.settings = {};
    hoisted.outbox = [];
    hoisted.storedId = null;
    hoisted.flushCalls = [];
    stopTelemetryWorker();
    vi.useFakeTimers();
  });
  afterEach(() => {
    stopTelemetryWorker();
    vi.useRealTimers();
  });

  it("does nothing when telemetry is disabled (default)", () => {
    emitTelemetryEvent("app.opened");
    expect(hoisted.outbox).toHaveLength(0);
  });

  it("writes to outbox when telemetry is enabled", () => {
    hoisted.settings["telemetry.enabled"] = true;
    emitTelemetryEvent("app.opened", { source: "desktop" });
    expect(hoisted.outbox).toHaveLength(1);
    expect(hoisted.outbox[0]!.event_name).toBe("app.opened");
  });

  it("generates and stores anonymous_id on first emit", () => {
    hoisted.settings["telemetry.enabled"] = true;
    expect(hoisted.storedId).toBeNull();
    emitTelemetryEvent("app.opened");
    expect(hoisted.storedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("reuses existing anonymous_id on subsequent emits", () => {
    hoisted.settings["telemetry.enabled"] = true;
    hoisted.storedId = "00000000-0000-0000-0000-000000000099";
    emitTelemetryEvent("app.opened");
    emitTelemetryEvent("capture.created");
    const ids = hoisted.outbox.map((r) => r.anonymous_id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("00000000-0000-0000-0000-000000000099");
  });
});

describe("purgeOutbox", () => {
  it("clears outbox rows", () => {
    hoisted.outbox.push({ id: "x" });
    purgeOutbox();
    expect(hoisted.outbox).toHaveLength(0);
  });
});

describe("getOrCreateAnonymousId", () => {
  beforeEach(() => {
    hoisted.storedId = null;
  });

  it("creates and stores a new UUID when none exists", () => {
    const id = getOrCreateAnonymousId();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
    expect(hoisted.storedId).toBe(id);
  });

  it("returns the existing id on subsequent calls", () => {
    const first = getOrCreateAnonymousId();
    const second = getOrCreateAnonymousId();
    expect(first).toBe(second);
  });
});
