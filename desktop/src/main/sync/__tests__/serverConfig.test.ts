import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SERVER_URL } from "@calmly/shared";

// A minimal fake standing in for better-sqlite3's Database — just enough of
// the `.prepare(sql).get()/.run()` shape serverConfig.ts uses, backed by a
// single in-memory settings_json row (mirrors the real user_settings table).
function makeFakeDb(initial?: Record<string, unknown>) {
  let row: { settings_json: string } | undefined = initial
    ? { settings_json: JSON.stringify(initial) }
    : undefined;

  return {
    prepare(_sql: string) {
      return {
        get: () => row,
        run: (json: string) => {
          row = { settings_json: json };
        },
      };
    },
  } as any;
}

describe("resolveServerUrl", () => {
  const ORIGINAL_ENV = process.env["CALMLY_SYNC_URL"];

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env["CALMLY_SYNC_URL"];
    else process.env["CALMLY_SYNC_URL"] = ORIGINAL_ENV;
    vi.resetModules();
  });

  it("packaged + no override + no stored setting -> production hosted URL", async () => {
    delete process.env["CALMLY_SYNC_URL"];
    const { resolveServerUrl } = await import("../serverConfig");
    expect(resolveServerUrl(makeFakeDb(), true)).toBe(DEFAULT_SERVER_URL);
  });

  it("dev + no override + no stored setting -> local docker-compose default", async () => {
    delete process.env["CALMLY_SYNC_URL"];
    const { resolveServerUrl, DEV_DEFAULT_SERVER_URL } = await import(
      "../serverConfig"
    );
    expect(resolveServerUrl(makeFakeDb(), false)).toBe(DEV_DEFAULT_SERVER_URL);
  });

  it("stored custom server URL wins over the packaged default (self-host)", async () => {
    delete process.env["CALMLY_SYNC_URL"];
    const { resolveServerUrl } = await import("../serverConfig");
    const db = makeFakeDb({ syncServerUrl: "https://self-hosted.example" });
    expect(resolveServerUrl(db, true)).toBe("https://self-hosted.example");
  });

  it("env override wins over both stored setting and packaged state", async () => {
    process.env["CALMLY_SYNC_URL"] = "https://env-override.example";
    const { resolveServerUrl } = await import("../serverConfig");
    const db = makeFakeDb({ syncServerUrl: "https://self-hosted.example" });
    expect(resolveServerUrl(db, true)).toBe("https://env-override.example");
    expect(resolveServerUrl(db, false)).toBe("https://env-override.example");
  });

  it("ignores an invalid env override and falls through", async () => {
    process.env["CALMLY_SYNC_URL"] = "not a url";
    const { resolveServerUrl } = await import("../serverConfig");
    expect(resolveServerUrl(makeFakeDb(), true)).toBe(DEFAULT_SERVER_URL);
  });
});

describe("saveServerUrl / clearServerUrl", () => {
  beforeEach(() => {
    delete process.env["CALMLY_SYNC_URL"];
  });

  it("round-trips a saved URL through resolveServerUrl", async () => {
    const { resolveServerUrl, saveServerUrl } = await import("../serverConfig");
    const db = makeFakeDb();
    saveServerUrl(db, "https://custom.example/");
    expect(resolveServerUrl(db, true)).toBe("https://custom.example");
  });

  it("clearServerUrl removes the override, falling back to the packaged default", async () => {
    const { resolveServerUrl, saveServerUrl, clearServerUrl } = await import(
      "../serverConfig"
    );
    const db = makeFakeDb();
    saveServerUrl(db, "https://custom.example");
    clearServerUrl(db);
    expect(resolveServerUrl(db, true)).toBe(DEFAULT_SERVER_URL);
  });

  it("rejects an invalid URL", async () => {
    const { saveServerUrl } = await import("../serverConfig");
    const db = makeFakeDb();
    expect(() => saveServerUrl(db, "ftp://nope")).toThrow();
  });
});
