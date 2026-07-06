// REL-10: single place that decides which dev-only affordances are live.
// Both gates take `isPackaged` as a plain argument (rather than reading
// `app.isPackaged` themselves) so they're unit-testable without mocking the
// `electron` module — mirrors the updateService `isPackaged` DI pattern.
//
// See docs/RELEASING.md "Build & runtime configuration" for the full matrix.

export interface EnvConfigInput {
  isPackaged: boolean;
  env: NodeJS.ProcessEnv;
}

export interface ResolvedEnvConfig {
  /** CALMLY_DEV_AUTH=stub — sign in as dev@calmly.local, no server calls. */
  devAuthStubEnabled: boolean;
  /** LOG_PII=true — bypass log scrubbing. Never honored in packaged builds. */
  allowPii: boolean;
}

export function resolveEnvConfig({ isPackaged, env }: EnvConfigInput): ResolvedEnvConfig {
  return {
    devAuthStubEnabled: !isPackaged && env["CALMLY_DEV_AUTH"] === "stub",
    allowPii: !isPackaged && env["LOG_PII"] === "true",
  };
}
