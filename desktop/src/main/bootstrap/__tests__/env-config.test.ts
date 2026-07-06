import { describe, expect, it } from "vitest";
import { resolveEnvConfig } from "../env-config";

describe("resolveEnvConfig — devAuthStubEnabled", () => {
  it("is disabled when app.isPackaged is true, even with CALMLY_DEV_AUTH=stub set", () => {
    const result = resolveEnvConfig({
      isPackaged: true,
      env: { CALMLY_DEV_AUTH: "stub" },
    });
    expect(result.devAuthStubEnabled).toBe(false);
  });

  it("is enabled only when unpackaged and CALMLY_DEV_AUTH=stub", () => {
    expect(
      resolveEnvConfig({ isPackaged: false, env: { CALMLY_DEV_AUTH: "stub" } })
        .devAuthStubEnabled,
    ).toBe(true);
  });

  it("is disabled when unpackaged but the env var is unset or wrong value", () => {
    expect(resolveEnvConfig({ isPackaged: false, env: {} }).devAuthStubEnabled).toBe(
      false,
    );
    expect(
      resolveEnvConfig({ isPackaged: false, env: { CALMLY_DEV_AUTH: "yes" } })
        .devAuthStubEnabled,
    ).toBe(false);
  });
});

describe("resolveEnvConfig — allowPii", () => {
  it("is disabled when app.isPackaged is true, even with LOG_PII=true set", () => {
    const result = resolveEnvConfig({
      isPackaged: true,
      env: { LOG_PII: "true" },
    });
    expect(result.allowPii).toBe(false);
  });

  it("is enabled only when unpackaged and LOG_PII=true", () => {
    expect(
      resolveEnvConfig({ isPackaged: false, env: { LOG_PII: "true" } }).allowPii,
    ).toBe(true);
  });

  it("is disabled when unpackaged but the env var is unset or wrong value", () => {
    expect(resolveEnvConfig({ isPackaged: false, env: {} }).allowPii).toBe(false);
    expect(
      resolveEnvConfig({ isPackaged: false, env: { LOG_PII: "1" } }).allowPii,
    ).toBe(false);
  });
});
